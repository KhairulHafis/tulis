import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { cloneTestRepo, createTestRepo, type TestRepo } from "@tulis/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { diffTrees, parseDiffTree } from "./diff-tree.js";
import { findGit, type GitExecutable } from "./find-git.js";
import { createGitRunner } from "./git-runner.js";

const T = 30_000;
const ID1 = "a".repeat(40);
const ID2 = "b".repeat(40);
const ID64 = "c".repeat(64);
const ZERO = "0".repeat(40);
const BAD = "Unexpected record in git diff-tree output";

function rec(
  oldMode: string,
  newMode: string,
  oldId: string,
  newId: string,
  status: string,
  path: string,
): string {
  return `:${oldMode} ${newMode} ${oldId} ${newId} ${status}\0${path}\0`;
}

describe("parseDiffTree", () => {
  it("parses empty output", () => {
    expect(parseDiffTree("")).toEqual({ changes: [], skipped: [] });
  });

  it("parses added, modified and deleted files, including SHA-256", () => {
    const out =
      rec("000000", "100644", ZERO, ID1, "A", "a.md") +
      rec("100644", "100755", ID1, ID2, "M", "d/b.md") +
      rec("100755", "000000", ID2, ZERO, "D", "c.md") +
      rec("100644", "100644", ID64, "d".repeat(64), "M", "e.md");
    expect(parseDiffTree(out)).toEqual({
      changes: [
        { path: "a.md", kind: "added", newBlobId: ID1 },
        { path: "d/b.md", kind: "modified", oldBlobId: ID1, newBlobId: ID2 },
        { path: "c.md", kind: "deleted", oldBlobId: ID2 },
        {
          path: "e.md",
          kind: "modified",
          oldBlobId: ID64,
          newBlobId: "d".repeat(64),
        },
      ],
      skipped: [],
    });
  });

  it("keeps newlines, tabs and a leading dash in paths", () => {
    const out =
      rec("000000", "100644", ZERO, ID1, "A", "a\nb\tc.md") +
      rec("000000", "100644", ZERO, ID1, "A", "--output=x.md");
    expect(parseDiffTree(out).changes.map((c) => c.path)).toEqual([
      "a\nb\tc.md",
      "--output=x.md",
    ]);
  });

  it("handles type changes by mode", () => {
    const out =
      rec("100644", "120000", ID1, ID2, "T", "a") +
      rec("120000", "100644", ID1, ID2, "T", "b") +
      rec("100644", "160000", ID1, ID2, "T", "c") +
      rec("160000", "100644", ID1, ID2, "T", "d");
    expect(parseDiffTree(out)).toEqual({
      changes: [
        { path: "a", kind: "deleted", oldBlobId: ID1 },
        { path: "b", kind: "added", newBlobId: ID2 },
        { path: "c", kind: "deleted", oldBlobId: ID1 },
        { path: "d", kind: "added", newBlobId: ID2 },
      ],
      skipped: [
        { path: "a", reason: "symlink" },
        { path: "c", reason: "submodule" },
      ],
    });
  });

  it("skips symlinks and submodules that are added, changed or removed", () => {
    const out =
      rec("000000", "120000", ZERO, ID1, "A", "l") +
      rec("000000", "160000", ZERO, ID1, "A", "s") +
      rec("120000", "160000", ID1, ID2, "T", "x") +
      rec("120000", "000000", ID1, ZERO, "D", "gone-link") +
      rec("160000", "000000", ID1, ZERO, "D", "gone-sub") +
      rec("120000", "120000", ID1, ID2, "M", "m");
    expect(parseDiffTree(out)).toEqual({
      changes: [],
      skipped: [
        { path: "l", reason: "symlink" },
        { path: "s", reason: "submodule" },
        { path: "x", reason: "submodule" },
        { path: "m", reason: "symlink" },
      ],
    });
  });

  it("skips unsafe paths with the unsafe-path reason only", () => {
    const out =
      rec("000000", "100644", ZERO, ID1, "A", "a/../b") +
      rec("100644", "000000", ID1, ZERO, "D", ".git/config") +
      rec("100644", "120000", ID1, ID2, "T", "../l");
    expect(parseDiffTree(out)).toEqual({
      changes: [],
      skipped: [
        { path: "a/../b", reason: "unsafe-path" },
        { path: ".git/config", reason: "unsafe-path" },
        { path: "../l", reason: "unsafe-path" },
      ],
    });
  });

  it("throws the exact message on malformed output", () => {
    const ok = rec("000000", "100644", ZERO, ID1, "A", "a.md");
    const bad = [
      "garbage",
      "\0",
      ":000000 100644 " + ZERO + " " + ID1 + " A\0", // missing path
      ok + "\0", // stray empty record
      ok + "extra\0", // odd number of parts
      rec("000000", "100644", ZERO, ID1, "R", "a.md"), // unknown status
      rec("000000", "100644", ZERO, ID1, "AM", "a.md"),
      rec("000000", "100664", ZERO, ID1, "A", "a.md"), // unknown mode
      rec("000000", "040000", ZERO, ID1, "A", "a.md").replace(
        "040000",
        "04000",
      ),
      rec("000000", "100644", ZERO, ZERO, "A", "a.md"), // zero id, real mode
      rec("100644", "100644", ID1, ZERO, "M", "a.md"),
      rec("000000", "100644", ID1, ID2, "A", "a.md"), // real id, absent mode
      rec("100644", "000000", ID1, ID2, "D", "a.md"),
      rec("000000", "100644", "a".repeat(39), ID1, "A", "a.md"), // short id
      rec("000000", "100644", ZERO, "A".repeat(40), "A", "a.md"), // upper case
      rec("000000", "100644", ZERO, ID1, "A", ""), // empty path
      ` ${ok}`,
    ];
    for (const out of bad) {
      expect(() => parseDiffTree(out), JSON.stringify(out)).toThrow(
        new Error(BAD),
      );
    }
  });

  it("does not leak the path or raw output in errors", () => {
    const secret = "secret\u001b[31mname.md";
    try {
      parseDiffTree(rec("000000", "100664", ZERO, ID1, "A", secret));
      expect.unreachable();
    } catch (error) {
      expect(String(error)).toBe(`Error: ${BAD}`);
    }
  });
});

let git: GitExecutable;
const repos: TestRepo[] = [];

function track(repo: TestRepo): TestRepo {
  repos.push(repo);
  return repo;
}

beforeAll(async () => {
  git = await findGit();
});

afterEach(() => {
  for (const repo of repos.splice(0)) {
    repo.cleanup();
  }
});

async function rev(repo: TestRepo, ref: string): Promise<string> {
  return (await repo.git(["rev-parse", ref])).trim();
}

async function addToIndex(
  repo: TestRepo,
  mode: string,
  id: string,
  path: string,
): Promise<void> {
  await repo.git([
    "update-index",
    "--add",
    "--cacheinfo",
    `${mode},${id},${path}`,
  ]);
}

describe("diffTrees with a real repo", () => {
  it(
    "reports added, modified and deleted files, not unchanged ones",
    async () => {
      const repo = track(await createTestRepo());
      const c1 = await repo.commit({
        message: "one",
        files: { "keep.md": "k", "mod.md": "one", "gone.md": "g" },
      });
      const c2 = await repo.commit({
        message: "two",
        files: { "mod.md": "two", "new.md": "n", "d/deep.md": "deep" },
        remove: ["gone.md"],
      });
      const diff = await diffTrees(createGitRunner(git, repo.dir), c1, c2);
      expect(diff.skipped).toEqual([]);
      expect(diff.changes).toEqual([
        {
          path: "d/deep.md",
          kind: "added",
          newBlobId: await rev(repo, `${c2}:d/deep.md`),
        },
        {
          path: "gone.md",
          kind: "deleted",
          oldBlobId: await rev(repo, `${c1}:gone.md`),
        },
        {
          path: "mod.md",
          kind: "modified",
          oldBlobId: await rev(repo, `${c1}:mod.md`),
          newBlobId: await rev(repo, `${c2}:mod.md`),
        },
        {
          path: "new.md",
          kind: "added",
          newBlobId: await rev(repo, `${c2}:new.md`),
        },
      ]);
    },
    T,
  );

  it(
    "gives no changes for identical commits",
    async () => {
      const repo = track(await createTestRepo());
      const c1 = await repo.commit({ message: "one", files: { "a.md": "a" } });
      const diff = await diffTrees(createGitRunner(git, repo.dir), c1, c1);
      expect(diff).toEqual({ changes: [], skipped: [] });
    },
    T,
  );

  it(
    "reports a mode-only change as modified",
    async () => {
      const repo = track(await createTestRepo());
      const c1 = await repo.commit({ message: "one", files: { "a.md": "a" } });
      await repo.git(["update-index", "--chmod=+x", "a.md"]);
      await repo.git(["commit", "-q", "-m", "chmod"]);
      const c2 = await rev(repo, "HEAD");
      const id = await rev(repo, `${c1}:a.md`);
      const diff = await diffTrees(createGitRunner(git, repo.dir), c1, c2);
      expect(diff.changes).toEqual([
        { path: "a.md", kind: "modified", oldBlobId: id, newBlobId: id },
      ]);
    },
    T,
  );

  it(
    "handles a file becoming a symlink and back, and a new submodule",
    async () => {
      const repo = track(await createTestRepo());
      const c1 = await repo.commit({
        message: "one",
        files: { "a.md": "a", "b.md": "b" },
      });
      writeFileSync(join(repo.dir, "payload.txt"), "target\n");
      const payload = (
        await repo.git(["hash-object", "-w", "--", "payload.txt"])
      ).trim();
      await addToIndex(repo, "120000", payload, "a.md");
      await addToIndex(repo, "160000", c1, "vendor/sub");
      await repo.git(["commit", "-q", "-m", "link"]);
      const c2 = await rev(repo, "HEAD");
      const runner = createGitRunner(git, repo.dir);

      const forward = await diffTrees(runner, c1, c2);
      expect(forward.changes).toEqual([
        {
          path: "a.md",
          kind: "deleted",
          oldBlobId: await rev(repo, `${c1}:a.md`),
        },
      ]);
      expect(forward.skipped).toEqual([
        { path: "a.md", reason: "symlink" },
        { path: "vendor/sub", reason: "submodule" },
      ]);

      const back = await diffTrees(runner, c2, c1);
      expect(back.changes).toEqual([
        {
          path: "a.md",
          kind: "added",
          newBlobId: await rev(repo, `${c1}:a.md`),
        },
      ]);
      expect(back.skipped).toEqual([]);
    },
    T,
  );

  it(
    "shows a moved file as a delete and an add",
    async () => {
      const repo = track(await createTestRepo());
      const c1 = await repo.commit({
        message: "one",
        files: { "old.md": "same content\n" },
      });
      const c2 = await repo.commit({
        message: "move",
        files: { "docs/new.md": "same content\n" },
        remove: ["old.md"],
      });
      const diff = await diffTrees(createGitRunner(git, repo.dir), c1, c2);
      const id = await rev(repo, `${c1}:old.md`);
      expect(diff.changes).toEqual([
        { path: "docs/new.md", kind: "added", newBlobId: id },
        { path: "old.md", kind: "deleted", oldBlobId: id },
      ]);
    },
    T,
  );

  it(
    "passes paths with spaces and leading dashes through exactly",
    async () => {
      const repo = track(await createTestRepo());
      const c1 = await repo.commit({ message: "one", files: { "a.md": "a" } });
      const c2 = await repo.commit({
        message: "two",
        files: {
          "with space/a b.md": "1",
          "-x.md": "2",
          "--output=x.md": "3",
        },
      });
      const diff = await diffTrees(createGitRunner(git, repo.dir), c1, c2);
      expect(diff.changes.map((c) => c.path).sort()).toEqual([
        "--output=x.md",
        "-x.md",
        "with space/a b.md",
      ]);
      expect(diff.changes.every((c) => c.kind === "added")).toBe(true);
    },
    T,
  );

  it(
    "rejects bad commits before running git",
    async () => {
      const runner = createGitRunner(
        {
          path: join(process.cwd(), "no-such-git-program"),
          version: git.version,
        },
        process.cwd(),
      );
      const real = track(await createTestRepo());
      const id = await real.commit({ message: "m", files: { "a.md": "a" } });
      for (const bad of [
        "HEAD",
        id.slice(0, 7),
        id.toUpperCase(),
        "--output=x",
      ]) {
        await expect(diffTrees(runner, bad, id), bad).rejects.toThrow(
          /Not a full object ID/,
        );
        await expect(diffTrees(runner, id, bad), bad).rejects.toThrow(
          /Not a full object ID/,
        );
      }
    },
    T,
  );

  it(
    "works in a partial clone without downloading blobs",
    async () => {
      const source = track(await createTestRepo());
      const c1 = await source.commit({
        message: "one",
        files: { "a.md": "one", "b.md": "bee" },
      });
      const c2 = await source.commit({
        message: "two",
        files: { "a.md": "two", "c.md": "cee" },
        remove: ["b.md"],
      });
      const clone = track(await cloneTestRepo(source, { partial: true }));
      const countMissing = async (): Promise<number> =>
        (await clone.git(["rev-list", "--objects", "--all", "--missing=print"]))
          .split("\n")
          .filter((line) => line.startsWith("?")).length;
      const before = await countMissing();
      expect(before).toBeGreaterThan(0);

      const diff = await diffTrees(createGitRunner(git, clone.dir), c1, c2);
      expect(diff.changes.map((c) => [c.path, c.kind])).toEqual([
        ["a.md", "modified"],
        ["b.md", "deleted"],
        ["c.md", "added"],
      ]);
      expect(await countMissing()).toBe(before);
    },
    T,
  );
});
