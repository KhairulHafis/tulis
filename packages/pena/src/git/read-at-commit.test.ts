import { cloneTestRepo, createTestRepo, type TestRepo } from "@tulis/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { findGit, type GitExecutable } from "./find-git.js";
import { createGitRunner, type GitRunner } from "./git-runner.js";
import { readFileAtCommit } from "./read-at-commit.js";

const T = 30_000;

describe("readFileAtCommit", () => {
  let git: GitExecutable;
  let repos: TestRepo[] = [];

  beforeAll(async () => {
    git = await findGit();
  });

  afterEach(() => {
    for (const repo of repos) {
      repo.cleanup();
    }
    repos = [];
  });

  async function newRepo(): Promise<TestRepo> {
    const repo = await createTestRepo();
    repos.push(repo);
    return repo;
  }

  function runnerFor(repo: TestRepo): GitRunner {
    return createGitRunner(git, repo.dir);
  }

  async function addIndexEntry(
    repo: TestRepo,
    mode: string,
    id: string,
    path: string,
  ): Promise<string> {
    await repo.git([
      "update-index",
      "--add",
      "--cacheinfo",
      `${mode},${id},${path}`,
    ]);
    await repo.git(["commit", "-q", "-m", `add ${path}`]);
    return (await repo.git(["rev-parse", "HEAD"])).trim();
  }

  it(
    "reads the old bytes of a file in a subfolder",
    async () => {
      const repo = await newRepo();
      const old = await repo.commit({
        message: "one",
        files: { "docs/a.md": "old\n" },
      });
      const head = await repo.commit({
        message: "two",
        files: { "docs/a.md": "new\n" },
      });
      const runner = runnerFor(repo);

      const result = await readFileAtCommit(runner, old, "docs/a.md");
      expect(result.kind).toBe("content");
      if (result.kind === "content") {
        expect(result.content.toString("utf8")).toBe("old\n");
      }
      const latest = await readFileAtCommit(runner, head, "docs/a.md");
      if (latest.kind !== "content") {
        throw new Error("Expected content");
      }
      expect(latest.content.toString("utf8")).toBe("new\n");
    },
    T,
  );

  it(
    "returns the bytes exactly as stored",
    async () => {
      const repo = await newRepo();
      const bytes = Buffer.from("line one\r\ncafé ☃\r\n", "utf8");
      const commit = await repo.commit({
        message: "crlf",
        files: { "a.md": bytes },
      });

      const result = await readFileAtCommit(runnerFor(repo), commit, "a.md");
      if (result.kind !== "content") {
        throw new Error("Expected content");
      }
      expect(result.content.equals(bytes)).toBe(true);
    },
    T,
  );

  it(
    "reports not-found for added and deleted paths",
    async () => {
      const repo = await newRepo();
      const first = await repo.commit({
        message: "one",
        files: { "gone.md": "x\n" },
      });
      const second = await repo.commit({
        message: "two",
        files: { "added.md": "y\n" },
        remove: ["gone.md"],
      });
      const runner = runnerFor(repo);

      expect(await readFileAtCommit(runner, first, "added.md")).toEqual({
        kind: "not-found",
      });
      expect((await readFileAtCommit(runner, first, "gone.md")).kind).toBe(
        "content",
      );
      expect(await readFileAtCommit(runner, second, "gone.md")).toEqual({
        kind: "not-found",
      });
    },
    T,
  );

  it(
    "reports a folder as not-a-file",
    async () => {
      const repo = await newRepo();
      const commit = await repo.commit({
        message: "one",
        files: { "d/a.md": "x\n" },
      });

      expect(await readFileAtCommit(runnerFor(repo), commit, "d")).toEqual({
        kind: "not-a-file",
        entryKind: "folder",
      });
    },
    T,
  );

  it(
    "reports a symlink and a submodule as not-a-file",
    async () => {
      const repo = await newRepo();
      await repo.commit({ message: "one", files: { "a.md": "x\n" } });
      const blobId = (await repo.git(["rev-parse", "HEAD:a.md"])).trim();
      const commitId = (await repo.git(["rev-parse", "HEAD"])).trim();
      const withLink = await addIndexEntry(repo, "120000", blobId, "link");
      const withSub = await addIndexEntry(repo, "160000", commitId, "sub");
      const runner = runnerFor(repo);

      expect(await readFileAtCommit(runner, withLink, "link")).toEqual({
        kind: "not-a-file",
        entryKind: "symlink",
      });
      expect(await readFileAtCommit(runner, withSub, "sub")).toEqual({
        kind: "not-a-file",
        entryKind: "submodule",
      });
    },
    T,
  );

  it(
    "treats a path with different letter case as not-found",
    async () => {
      const repo = await newRepo();
      const commit = await repo.commit({
        message: "one",
        files: { "d/a.md": "x\n" },
      });

      expect(await readFileAtCommit(runnerFor(repo), commit, "D/A.md")).toEqual(
        {
          kind: "not-found",
        },
      );
    },
    T,
  );

  it(
    "reports too-large with the size",
    async () => {
      const repo = await newRepo();
      const commit = await repo.commit({
        message: "one",
        files: { "a.md": "123456789" },
      });

      const result = await readFileAtCommit(runnerFor(repo), commit, "a.md", {
        maxBlobBytes: 4,
      });
      expect(result.kind).toBe("too-large");
      if (result.kind === "too-large") {
        expect(result.size).toBe(9);
      }
    },
    T,
  );

  it(
    "reports missing-object in a partial clone without downloading",
    async () => {
      const source = await newRepo();
      const old = await source.commit({
        message: "one",
        files: { "a.md": "old content\n" },
      });
      await source.commit({
        message: "two",
        files: { "a.md": "new content\n" },
      });
      const clone = await cloneTestRepo(source, { partial: true });
      repos.push(clone);
      const runner = runnerFor(clone);
      const count = async (): Promise<number> =>
        (await clone.git(["rev-list", "--objects", "--all", "--missing=print"]))
          .split("\n")
          .filter((line) => line.startsWith("?")).length;

      const before = await count();
      expect(before).toBeGreaterThan(0);
      const result = await readFileAtCommit(runner, old, "a.md");
      expect(result.kind).toBe("missing-object");
      expect(await count()).toBe(before);

      const head = (await clone.git(["rev-parse", "HEAD"])).trim();
      const current = await readFileAtCommit(runner, head, "a.md");
      expect(current.kind).toBe("content");
    },
    T,
  );
});

// Git can match other spellings of a path on case-insensitive systems, which a
// Mac test repo can't reproduce, so these tests stand in for git's answer.
describe("readFileAtCommit with git's ls-tree answer given", () => {
  const commit = "a".repeat(40);
  const blobId = "b".repeat(40);

  function runnerAnswering(lsTreeOutput: string): GitRunner {
    return {
      git: { path: "/unused/git", version: { major: 2, minor: 50, patch: 0 } },
      repoDir: "/unused",
      run: () => Promise.resolve(lsTreeOutput),
      start: () => {
        throw new Error("The blob reader must not start");
      },
    };
  }

  it("ignores an entry whose path is only a different spelling", async () => {
    const runner = runnerAnswering(`100644 blob ${blobId}\tD/A.md\0`);
    expect(await readFileAtCommit(runner, commit, "d/a.md")).toEqual({
      kind: "not-found",
    });
  });

  it("refuses two entries with the exact path", async () => {
    const record = `100644 blob ${blobId}\td/a.md\0`;
    const runner = runnerAnswering(record + record);
    await expect(readFileAtCommit(runner, commit, "d/a.md")).rejects.toThrow(
      "Unexpected git ls-tree output",
    );
  });
});
