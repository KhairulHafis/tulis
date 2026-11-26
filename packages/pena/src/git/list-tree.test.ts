import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { cloneTestRepo, createTestRepo, type TestRepo } from "@tulis/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { findGit, type GitExecutable } from "./find-git.js";
import { createGitRunner } from "./git-runner.js";
import { isSafeTreePath, listTree, parseLsTree } from "./list-tree.js";

const T = 30_000;
const ID1 = "a".repeat(40);
const ID2 = "b".repeat(40);
const ID64 = "c".repeat(64);

function rec(mode: string, type: string, id: string, path: string): string {
  return `${mode} ${type} ${id}\t${path}\0`;
}

describe("isSafeTreePath", () => {
  it("accepts normal paths", () => {
    for (const p of [
      "a.md",
      "docs/a.md",
      ".gitignore",
      ".github/x.md",
      "docs/..x.md",
      "-x.md",
      "dir/with space/é.md",
      "a\nb",
    ]) {
      expect(isSafeTreePath(p), p).toBe(true);
    }
  });

  it("rejects unsafe paths", () => {
    for (const p of [
      "",
      "..",
      ".",
      "a/../b",
      "./a",
      "a//b",
      "a/",
      "/abs",
      ".git",
      ".git/config",
      "docs/.GIT/x",
      "a/.Git",
      "a\\b",
      "a\0b",
    ]) {
      expect(isSafeTreePath(p), p).toBe(false);
    }
  });
});

describe("parseLsTree", () => {
  it("parses an empty listing", () => {
    expect(parseLsTree("")).toEqual({ files: [], skipped: [] });
  });

  it("parses files, executables and SHA-256 IDs", () => {
    const out =
      rec("100644", "blob", ID1, "a.md") +
      rec("100755", "blob", ID2, "bin/run.md") +
      rec("100644", "blob", ID64, "docs/é 日本.md");
    expect(parseLsTree(out)).toEqual({
      files: [
        { path: "a.md", blobId: ID1, executable: false },
        { path: "bin/run.md", blobId: ID2, executable: true },
        { path: "docs/é 日本.md", blobId: ID64, executable: false },
      ],
      skipped: [],
    });
  });

  it("keeps newlines, tabs and a leading dash in paths", () => {
    const out =
      rec("100644", "blob", ID1, "a\nb\tc.md") +
      rec("100644", "blob", ID2, "--output=x.md");
    expect(parseLsTree(out).files.map((f) => f.path)).toEqual([
      "a\nb\tc.md",
      "--output=x.md",
    ]);
  });

  it("skips symlinks and submodules", () => {
    const out =
      rec("120000", "blob", ID1, "link") +
      rec("160000", "commit", ID2, "vendor/sub") +
      rec("100644", "blob", ID1, "ok.md");
    expect(parseLsTree(out)).toEqual({
      files: [{ path: "ok.md", blobId: ID1, executable: false }],
      skipped: [
        { path: "link", reason: "symlink" },
        { path: "vendor/sub", reason: "submodule" },
      ],
    });
  });

  it("skips unsafe paths of any type", () => {
    const paths = [
      "..",
      "a/../b",
      "./a",
      "a//b",
      "/abs",
      ".git/config",
      "docs/.GIT/x",
      "a\\b",
    ];
    const out =
      paths.map((p) => rec("100644", "blob", ID1, p)).join("") +
      rec("120000", "blob", ID1, "../link") +
      rec("160000", "commit", ID1, ".git/sub");
    const result = parseLsTree(out);
    expect(result.files).toEqual([]);
    expect(result.skipped.map((s) => s.path)).toEqual([
      ...paths,
      "../link",
      ".git/sub",
    ]);
    expect(result.skipped.every((s) => s.reason === "unsafe-path")).toBe(true);
  });

  it("throws on malformed records", () => {
    const bad = [
      `10064x blob ${ID1}\ta.md\0`,
      `100644 blob ${ID1} a.md\0`,
      `100644 blob ${"a".repeat(39)}\ta.md\0`,
      `100644 blob ${"A".repeat(40)}\ta.md\0`,
      `100644 tree ${ID1}\ta\0`,
      `100644 blob ${ID1}\t\0`,
      rec("100644", "blob", ID1, "a.md") +
        "\0" +
        rec("100644", "blob", ID1, "b.md"),
      "\0",
      rec("100644", "blob", ID1, "a.md") + "\0",
      "garbage",
    ];
    for (const out of bad) {
      expect(() => parseLsTree(out), JSON.stringify(out)).toThrow(Error);
    }
  });

  it("throws on an odd mode or type, without the raw record", () => {
    const secret = "secret\u001b[31mname.md";
    expect(() => parseLsTree(rec("100664", "blob", ID1, secret))).toThrow(
      /Unexpected mode 100664/,
    );
    expect(() => parseLsTree(rec("160000", "blob", ID1, "x"))).toThrow(
      /Unexpected mode/,
    );
    expect(() => parseLsTree(rec("120000", "commit", ID1, "x"))).toThrow(
      /Unexpected mode/,
    );
    try {
      parseLsTree(rec("100664", "blob", ID1, secret));
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain("\u001b");
      expect(String(error)).not.toContain(ID1);
    }
  });

  it("accepts a final record without a trailing NUL", () => {
    expect(
      parseLsTree(`100644 blob ${ID1}\ta.md`).files.map((f) => f.path),
    ).toEqual(["a.md"]);
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

describe("listTree with a real repo", () => {
  it(
    "lists normal files and skips symlinks and submodules",
    async () => {
      const repo = track(await createTestRepo());
      const commit0 = await repo.commit({
        message: "files",
        files: {
          "README.md": "r",
          "docs/guide/intro.md": "intro",
          "docs/with space.md": "space",
          "docs/café-日本.md": "unicode",
          "--output=x.md": "flag",
        },
      });
      expect(commit0).toMatch(/^[0-9a-f]{40}$/);
      // Entries that Windows can't hold on disk go in through the index.
      // Git for Windows refuses such names in the index while
      // core.protectNTFS is on (its default), so turn it off for this repo.
      await repo.git(["config", "core.protectNTFS", "false"]);
      writeFileSync(join(repo.dir, "payload.txt"), "payload\n");
      const payloadId = (
        await repo.git(["hash-object", "-w", "--", "payload.txt"])
      ).trim();
      const entries: [string, string, string][] = [
        ["100755", payloadId, "bin/tool.sh"],
        ["100644", payloadId, "odd/new\nline.md"],
        ["100644", payloadId, "odd/tab\there.md"],
        ["120000", payloadId, "link.md"],
        ["160000", ID1, "vendor/sub"],
      ];
      for (const [mode, id, path] of entries) {
        await repo.git([
          "update-index",
          "--add",
          "--cacheinfo",
          `${mode},${id},${path}`,
        ]);
      }
      await repo.git(["commit", "-q", "-m", "special"]);
      const commit = await rev(repo, "HEAD");

      const listing = await listTree(createGitRunner(git, repo.dir), commit);
      const expectedPaths = [
        "--output=x.md",
        "README.md",
        "bin/tool.sh",
        "docs/café-日本.md",
        "docs/guide/intro.md",
        "docs/with space.md",
        "odd/new\nline.md",
        "odd/tab\there.md",
      ];
      expect(listing.files.map((f) => f.path)).toEqual(expectedPaths);
      for (const file of listing.files) {
        expect(file.blobId).toBe(await rev(repo, `${commit}:${file.path}`));
        expect(file.executable).toBe(file.path === "bin/tool.sh");
      }
      expect(listing.skipped).toEqual([
        { path: "link.md", reason: "symlink" },
        { path: "vendor/sub", reason: "submodule" },
      ]);
    },
    T,
  );

  it(
    "skips crafted '..' and '.git' entries that plain git lists",
    async () => {
      const repo = track(await createTestRepo());
      writeFileSync(join(repo.dir, "payload.txt"), "payload\n");
      const blobId = (
        await repo.git(["hash-object", "-w", "--", "payload.txt"])
      ).trim();
      // A raw tree object: "<mode> <name>\0<20-byte id>" per entry, sorted by
      // name. git's own checks refuse these names, so write it --literally.
      const rawId = Buffer.from(blobId, "hex");
      const tree = Buffer.concat(
        ["..", ".git", "ok.md"].flatMap((name) => [
          Buffer.from(`100644 ${name}\0`),
          rawId,
        ]),
      );
      writeFileSync(join(repo.dir, "tree.bin"), tree);
      const treeId = (
        await repo.git([
          "hash-object",
          "-t",
          "tree",
          "-w",
          "--literally",
          "--",
          "tree.bin",
        ])
      ).trim();
      const commit = (
        await repo.git(["commit-tree", "-m", "crafted", treeId])
      ).trim();

      // Control: plain git lists the crafted names.
      const plain = await repo.git(["ls-tree", "-r", "--name-only", commit]);
      expect(plain.split("\n")).toEqual(
        expect.arrayContaining(["..", ".git", "ok.md"]),
      );

      const listing = await listTree(createGitRunner(git, repo.dir), commit);
      expect(listing.files).toEqual([
        { path: "ok.md", blobId, executable: false },
      ]);
      expect(listing.skipped).toEqual([
        { path: "..", reason: "unsafe-path" },
        { path: ".git", reason: "unsafe-path" },
      ]);
    },
    T,
  );

  it(
    "rejects a bad commit before running git",
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
        "--output=x",
        id.slice(0, 7),
        id.toUpperCase(),
        "",
        `${id}\n`,
      ]) {
        await expect(listTree(runner, bad), bad).rejects.toThrow(
          /Not a full object ID/,
        );
      }
    },
    T,
  );

  it(
    "lists a partial clone without downloading blobs",
    async () => {
      const source = track(await createTestRepo());
      const first = await source.commit({
        message: "one",
        files: { "a.md": "one", "docs/b.md": "bee" },
      });
      await source.commit({ message: "two", files: { "a.md": "two" } });
      const clone = track(await cloneTestRepo(source, { partial: true }));
      const countMissing = async (): Promise<number> =>
        (await clone.git(["rev-list", "--objects", "--all", "--missing=print"]))
          .split("\n")
          .filter((line) => line.startsWith("?")).length;
      const before = await countMissing();
      expect(before).toBeGreaterThanOrEqual(1);

      const listing = await listTree(createGitRunner(git, clone.dir), first);
      expect(listing.files.map((f) => f.path)).toEqual(["a.md", "docs/b.md"]);
      for (const file of listing.files) {
        expect(file.blobId).toBe(await rev(source, `${first}:${file.path}`));
      }
      expect(await countMissing()).toBe(before);
    },
    T,
  );
});
