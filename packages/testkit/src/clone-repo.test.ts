import { afterEach, describe, expect, it } from "vitest";
import { cloneTestRepo } from "./clone-repo.js";
import { createTestRepo, type TestRepo } from "./git-repo.js";

const repos: TestRepo[] = [];
const T = 30_000;

function track(repo: TestRepo): TestRepo {
  repos.push(repo);
  return repo;
}

async function threeCommitSource(): Promise<TestRepo> {
  const source = track(await createTestRepo());
  await source.commit({ message: "1", files: { "a.md": "one\ntwo\n" } });
  await source.commit({ message: "2", files: { "a.md": "one\ntwo\nthree\n" } });
  await source.commit({ message: "3", files: { "b.md": "B" } });
  return source;
}

async function rev(repo: TestRepo, ref: string): Promise<string> {
  return (await repo.git(["rev-parse", ref])).trim();
}

afterEach(() => {
  for (const repo of repos.splice(0)) {
    repo.cleanup();
  }
});

describe("cloneTestRepo", () => {
  it(
    "makes a full clone with origin/main and main",
    async () => {
      const source = await threeCommitSource();
      const head = await rev(source, "HEAD");
      const clone = track(await cloneTestRepo(source));
      expect(clone.dir).not.toBe(source.dir);
      expect(await rev(clone, "origin/main")).toBe(head);
      expect(await rev(clone, "main")).toBe(head);
      expect(
        (await clone.git(["rev-parse", "--is-shallow-repository"])).trim(),
      ).toBe("false");
      clone.cleanup();
      expect(await rev(source, "HEAD")).toBe(head);
    },
    T,
  );

  it(
    "can leave local main behind origin/main",
    async () => {
      const source = await threeCommitSource();
      const old = await rev(source, "HEAD");
      const clone = track(await cloneTestRepo(source));
      const added = await source.commit({
        message: "4",
        files: { "c.md": "C" },
      });
      await clone.git(["fetch", "-q", "origin"]);
      expect(await rev(clone, "origin/main")).toBe(added);
      expect(await rev(clone, "main")).toBe(old);
    },
    T,
  );

  it(
    "makes a shallow clone",
    async () => {
      const source = await threeCommitSource();
      const clone = track(await cloneTestRepo(source, { depth: 1 }));
      expect(
        (await clone.git(["rev-parse", "--is-shallow-repository"])).trim(),
      ).toBe("true");
      expect((await clone.git(["rev-list", "--count", "HEAD"])).trim()).toBe(
        "1",
      );
    },
    T,
  );

  it(
    "makes a partial clone with missing blobs",
    async () => {
      const source = await threeCommitSource();
      const clone = track(await cloneTestRepo(source, { partial: true }));
      expect(
        (await clone.git(["config", "remote.origin.promisor"])).trim(),
      ).toBe("true");
      const listing = await clone.git([
        "rev-list",
        "--objects",
        "--all",
        "--missing=print",
      ]);
      const missing = listing.split("\n").filter((l) => l.startsWith("?"));
      expect(missing.length).toBeGreaterThanOrEqual(1);
    },
    T,
  );

  it(
    "checks out the requested branch",
    async () => {
      const source = await threeCommitSource();
      await source.createBranch("feature");
      const clone = track(await cloneTestRepo(source, { branch: "feature" }));
      expect((await clone.git(["symbolic-ref", "HEAD"])).trim()).toBe(
        "refs/heads/feature",
      );
    },
    T,
  );

  it(
    "dates a commit one day after the clone's HEAD",
    async () => {
      const source = await threeCommitSource();
      const clone = track(await cloneTestRepo(source));
      const before = Number(
        (await clone.git(["log", "-1", "--format=%ct"])).trim(),
      );
      await clone.commit({ message: "more", files: { "d.md": "D" } });
      const after = Number(
        (await clone.git(["log", "-1", "--format=%ct"])).trim(),
      );
      expect(after).toBe(before + 86400);
    },
    T,
  );
});

describe("line endings", () => {
  it(
    "applies core.autocrlf in a clone",
    async () => {
      const source = track(await createTestRepo());
      await source.commit({ message: "a", files: { "a.md": "one\ntwo\n" } });
      const crlf = track(
        await cloneTestRepo(source, { config: { "core.autocrlf": "true" } }),
      );
      expect(crlf.readFile("a.md").toString("utf8")).toBe("one\r\ntwo\r\n");
      expect(await crlf.git(["cat-file", "blob", "HEAD:a.md"])).toBe(
        "one\ntwo\n",
      );
      const plain = track(await cloneTestRepo(source));
      expect(plain.readFile("a.md").toString("utf8")).toBe("one\ntwo\n");
    },
    T,
  );

  it(
    "honors eol=crlf in .gitattributes",
    async () => {
      const source = track(await createTestRepo());
      await source.commit({
        message: "a",
        files: { ".gitattributes": "* text eol=crlf\n", "a.md": "one\ntwo\n" },
      });
      const clone = track(await cloneTestRepo(source));
      expect(clone.readFile("a.md").toString("utf8")).toBe("one\r\ntwo\r\n");
    },
    T,
  );

  it(
    "keeps CRLF in the blob when autocrlf is false",
    async () => {
      const repo = track(
        await createTestRepo({ config: { "core.autocrlf": "false" } }),
      );
      await repo.commit({ message: "x", files: { "a.md": "x\r\ny\r\n" } });
      expect(await repo.git(["cat-file", "blob", "HEAD:a.md"])).toBe(
        "x\r\ny\r\n",
      );
    },
    T,
  );
});

describe("option validation", () => {
  it(
    "rejects bad options before cloning",
    async () => {
      const source = track(await createTestRepo());
      await expect(cloneTestRepo(source, { depth: 0 })).rejects.toThrow(
        /Invalid clone depth/,
      );
      await expect(cloneTestRepo(source, { depth: 1.5 })).rejects.toThrow(
        /Invalid clone depth/,
      );
      await expect(cloneTestRepo(source, { branch: "-x" })).rejects.toThrow(
        /Invalid ref name "-x"/,
      );
      await expect(
        cloneTestRepo(source, { config: { "-c": "x" } }),
      ).rejects.toThrow(/Invalid git config key "-c"/);
      await expect(
        cloneTestRepo(source, { config: { nodot: "x" } }),
      ).rejects.toThrow(/Invalid git config key "nodot"/);
      await expect(
        cloneTestRepo(source, { config: { "a.b": "x\ny" } }),
      ).rejects.toThrow(/Invalid git config value/);
    },
    T,
  );
});
