import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cloneTestRepo, createTestRepo, type TestRepo } from "@tulis/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  detectCloneKind,
  isPartialClone,
  parsePromisorRemotes,
} from "./clone-kind.js";
import { findGit, type GitExecutable } from "./find-git.js";
import { createGitRunner } from "./git-runner.js";

const TIMEOUT = 30_000;
let git: GitExecutable;
const repos: TestRepo[] = [];
const folders: string[] = [];

beforeAll(async () => {
  git = await findGit();
});

afterEach(() => {
  for (const repo of repos.splice(0)) repo.cleanup();
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
});

async function newSource(): Promise<TestRepo> {
  const repo = await createTestRepo();
  repos.push(repo);
  for (const n of ["1", "2", "3", "4"]) {
    await repo.commit({
      message: `commit ${n}`,
      // One file changed each time, so old blobs are missing in a partial clone.
      files: { "doc.md": `content ${n}` },
    });
  }
  return repo;
}

async function newClone(
  source: TestRepo,
  options?: { depth?: number; partial?: boolean },
): Promise<TestRepo> {
  const clone = await cloneTestRepo(source, options);
  repos.push(clone);
  return clone;
}

describe("detectCloneKind", () => {
  it(
    "reports a normal repo as neither shallow nor partial",
    async () => {
      const repo = await newSource();
      const kind = await detectCloneKind(createGitRunner(git, repo.dir));
      expect(kind).toEqual({ shallow: false, partial: false });
    },
    TIMEOUT,
  );

  it(
    "reports a normal clone as neither",
    async () => {
      const clone = await newClone(await newSource());
      const kind = await detectCloneKind(createGitRunner(git, clone.dir));
      expect(kind).toEqual({ shallow: false, partial: false });
    },
    TIMEOUT,
  );

  it(
    "reports a depth 1 clone as shallow only",
    async () => {
      const clone = await newClone(await newSource(), { depth: 1 });
      const kind = await detectCloneKind(createGitRunner(git, clone.dir));
      expect(kind).toEqual({ shallow: true, partial: false });
    },
    TIMEOUT,
  );

  it(
    "reports a filtered clone as partial only",
    async () => {
      const clone = await newClone(await newSource(), { partial: true });
      const kind = await detectCloneKind(createGitRunner(git, clone.dir));
      expect(kind).toEqual({ shallow: false, partial: true });
    },
    TIMEOUT,
  );

  it(
    "reports a shallow and partial clone as both",
    async () => {
      const clone = await newClone(await newSource(), {
        depth: 1,
        partial: true,
      });
      const kind = await detectCloneKind(createGitRunner(git, clone.dir));
      expect(kind).toEqual({ shallow: true, partial: true });
    },
    TIMEOUT,
  );

  it(
    "downloads nothing in a partial clone",
    async () => {
      const clone = await newClone(await newSource(), { partial: true });
      const countMissing = async (): Promise<number> => {
        const out = await clone.git([
          "rev-list",
          "--objects",
          "--all",
          "--missing=print",
        ]);
        return out.split(/\r?\n/).filter((line) => line.startsWith("?")).length;
      };
      const before = await countMissing();
      expect(before).toBeGreaterThan(0);
      await detectCloneKind(createGitRunner(git, clone.dir));
      expect(await countMissing()).toBe(before);
    },
    TIMEOUT,
  );
});

describe("isPartialClone config handling", () => {
  it(
    "is true for a promisor remote set to true",
    async () => {
      const repo = await newSource();
      await repo.git(["config", "remote.other.promisor", "true"]);
      expect(await isPartialClone(createGitRunner(git, repo.dir))).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "is false for a promisor remote set to false",
    async () => {
      const repo = await newSource();
      await repo.git(["config", "remote.other.promisor", "false"]);
      expect(await isPartialClone(createGitRunner(git, repo.dir))).toBe(false);
    },
    TIMEOUT,
  );

  it(
    "is true when extensions.partialclone is set",
    async () => {
      const repo = await newSource();
      await repo.git(["config", "extensions.partialclone", "origin"]);
      expect(await isPartialClone(createGitRunner(git, repo.dir))).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "is true when a promisor value is not a boolean (safe side)",
    async () => {
      const repo = await newSource();
      await repo.git(["config", "remote.x.promisor", "maybe"]);
      expect(await isPartialClone(createGitRunner(git, repo.dir))).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "ignores GIT_CONFIG_PARAMETERS from the caller's environment",
    async () => {
      const repo = await newSource();
      const env = {
        ...process.env,
        GIT_CONFIG_PARAMETERS: "'remote.y.promisor'='true'",
      };
      expect(await isPartialClone(createGitRunner(git, repo.dir, env))).toBe(
        false,
      );
      // Control: plain git with the same variable does report it.
      const plain = execFileSync(
        git.path,
        ["config", "-z", "--bool", "--get-regexp", "^remote\\..*\\.promisor$"],
        { cwd: repo.dir, env, encoding: "utf8" },
      );
      expect(parsePromisorRemotes(plain)).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "rethrows spawn failures instead of answering partial",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "tulis-clone-kind-"));
      folders.push(dir);
      const runner = createGitRunner(
        { ...git, path: join(dir, "no-such-git") },
        dir,
      );
      await expect(isPartialClone(runner)).rejects.toMatchObject({
        name: "GitCommandError",
        failure: "spawn",
      });
      await expect(detectCloneKind(runner)).rejects.toThrow();
    },
    TIMEOUT,
  );
});

describe("parsePromisorRemotes", () => {
  it("is false for empty output", () => {
    expect(parsePromisorRemotes("")).toBe(false);
  });

  it("is true for one true record", () => {
    expect(parsePromisorRemotes("remote.origin.promisor\ntrue\0")).toBe(true);
  });

  it("is false for one false record", () => {
    expect(parsePromisorRemotes("remote.origin.promisor\nfalse\0")).toBe(false);
  });

  it("is true when any record is true", () => {
    expect(
      parsePromisorRemotes(
        "remote.a.promisor\nfalse\0remote.b.promisor\ntrue\0remote.c.promisor\nfalse\0",
      ),
    ).toBe(true);
  });

  it("handles dotted keys and remote names with spaces", () => {
    expect(parsePromisorRemotes("remote.a.b.c.promisor\ntrue\0")).toBe(true);
    expect(parsePromisorRemotes("remote.my remote.promisor\ntrue\0")).toBe(
      true,
    );
    expect(parsePromisorRemotes("remote.my remote.promisor\nfalse\0")).toBe(
      false,
    );
  });

  it("throws on a record without a newline", () => {
    expect(() => parsePromisorRemotes("remote.a.promisor true\0")).toThrow(
      "Unexpected git config output",
    );
  });

  it("throws on a value other than true or false", () => {
    expect(() => parsePromisorRemotes("remote.a.promisor\nmaybe\0")).toThrow(
      "Unexpected git config output",
    );
    expect(() => parsePromisorRemotes("remote.a.promisor\n\0")).toThrow(
      "Unexpected git config output",
    );
  });
});
