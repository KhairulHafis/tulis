import { cloneTestRepo, createTestRepo, type TestRepo } from "@tulis/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { openBlobReader, type BlobReader } from "./blob-reader.js";
import { findGit, type GitExecutable } from "./find-git.js";
import { createGitRunner } from "./git-runner.js";
import { listTree } from "./list-tree.js";
import { resolveProdRef } from "./prod-ref.js";

const T = 30_000;

const FILES: Readonly<Record<string, string>> = {
  "README.md": "# Readme\n",
  "docs/guide.md": "Guide\r\nwith CRLF\r\n",
  "docs/deep/notes.md": "no final newline",
  "--output=x.md": "named like a flag\n",
  "empty.md": "",
};

describe("reading every file at the prod ref", () => {
  let git: GitExecutable;
  let repos: TestRepo[] = [];
  let readers: BlobReader[] = [];

  beforeAll(async () => {
    git = await findGit();
  });

  afterEach(async () => {
    for (const reader of readers) {
      await reader.close();
    }
    for (const repo of repos) {
      repo.cleanup();
    }
    readers = [];
    repos = [];
  });

  function track(repo: TestRepo): TestRepo {
    repos.push(repo);
    return repo;
  }

  async function countMissing(repo: TestRepo): Promise<number> {
    const out = await repo.git([
      "rev-list",
      "--objects",
      "--all",
      "--missing=print",
    ]);
    return out.split("\n").filter((line) => line.startsWith("?")).length;
  }

  it(
    "reads the exact committed bytes of every file",
    async () => {
      const source = track(
        await createTestRepo({
          branch: "main",
          config: { "core.autocrlf": "false" },
        }),
      );
      await source.commit({ message: "docs", files: { ...FILES } });
      const clone = track(await cloneTestRepo(source));
      const runner = createGitRunner(git, clone.dir);

      const prod = await resolveProdRef(runner, "main");
      const listing = await listTree(runner, prod.commit);
      expect(listing.files.map((f) => f.path).sort()).toEqual(
        Object.keys(FILES).sort(),
      );

      const reader = openBlobReader(runner);
      readers.push(reader);
      const results = await Promise.all(
        listing.files.map((file) => reader.read(file.blobId)),
      );
      listing.files.forEach((file, index) => {
        const result = results[index];
        expect(result?.kind, file.path).toBe("content");
        expect(
          result?.kind === "content" ? result.content.toString("utf8") : "",
          file.path,
        ).toBe(FILES[file.path]);
      });
    },
    T,
  );

  it(
    "reports a blob a partial clone never downloaded as missing",
    async () => {
      const source = track(await createTestRepo({ branch: "main" }));
      await source.commit({ message: "docs", files: { ...FILES } });
      const clone = track(await cloneTestRepo(source, { partial: true }));
      const runner = createGitRunner(git, clone.dir);

      await source.commit({
        message: "new",
        files: { "docs/new.md": "brand new\n" },
      });
      await clone.git(["fetch", "-q", "origin"]);

      const prod = await resolveProdRef(runner, "main");
      expect(prod.commit).toBe(
        (await source.git(["rev-parse", "HEAD"])).trim(),
      );
      const listing = await listTree(runner, prod.commit);
      const paths = listing.files.map((f) => f.path);
      expect(paths).toContain("docs/new.md");

      const before = await countMissing(clone);
      expect(before).toBeGreaterThanOrEqual(1);

      const reader = openBlobReader(runner);
      readers.push(reader);
      for (const file of listing.files) {
        const result = await reader.read(file.blobId);
        if (file.path === "docs/new.md") {
          expect(result).toEqual({ kind: "missing", blobId: file.blobId });
        } else {
          expect(result.kind, file.path).toBe("content");
          expect(
            result.kind === "content" ? result.content.toString("utf8") : "",
            file.path,
          ).toBe(FILES[file.path]);
        }
      }
      await reader.close();
      expect(await countMissing(clone)).toBe(before);
    },
    T,
  );
});
