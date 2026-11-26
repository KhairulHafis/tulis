import { randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cloneTestRepo, createTestRepo, type TestRepo } from "@tulis/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { findGit, type GitExecutable } from "./find-git.js";
import { GitCommandError, createGitRunner } from "./git-runner.js";
import {
  NoProdRefError,
  prodRefCandidates,
  resolveProdRef,
} from "./prod-ref.js";

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

async function newRepo(): Promise<TestRepo> {
  const repo = await createTestRepo();
  repos.push(repo);
  await repo.commit({ message: "one", files: { "a.md": "1" } });
  return repo;
}

async function newClone(source: TestRepo): Promise<TestRepo> {
  const clone = await cloneTestRepo(source);
  repos.push(clone);
  return clone;
}

async function head(repo: TestRepo): Promise<string> {
  return (await repo.git(["rev-parse", "HEAD"])).trim();
}

describe("prodRefCandidates", () => {
  it("lists the remote ref first, then the local one", () => {
    expect(prodRefCandidates("main")).toEqual([
      "refs/remotes/origin/main",
      "refs/heads/main",
    ]);
  });

  it("throws on a bad name", () => {
    expect(() => prodRefCandidates("-x")).toThrow('Invalid branch name "-x"');
  });
});

describe("resolveProdRef", () => {
  it(
    "uses the local branch when there is no remote",
    async () => {
      const repo = await newRepo();
      const result = await resolveProdRef(
        createGitRunner(git, repo.dir),
        "main",
      );
      expect(result).toEqual({
        branch: "main",
        ref: "refs/heads/main",
        commit: await head(repo),
        source: "local",
      });
    },
    TIMEOUT,
  );

  it(
    "uses the remote-tracking ref in a clone",
    async () => {
      const source = await newRepo();
      const clone = await newClone(source);
      const result = await resolveProdRef(
        createGitRunner(git, clone.dir),
        "main",
      );
      expect(result.source).toBe("remote");
      expect(result.ref).toBe("refs/remotes/origin/main");
      expect(result.commit).toBe(await head(source));
    },
    TIMEOUT,
  );

  it(
    "ignores a newer local commit",
    async () => {
      const source = await newRepo();
      const clone = await newClone(source);
      const local = await clone.commit({
        message: "two",
        files: { "b.md": "2" },
      });
      const result = await resolveProdRef(
        createGitRunner(git, clone.dir),
        "main",
      );
      expect(result.commit).toBe(await head(source));
      expect(result.commit).not.toBe(local);
    },
    TIMEOUT,
  );

  it(
    "finds a branch that exists only on the remote",
    async () => {
      const source = await newRepo();
      await source.createBranch("prod");
      const clone = await newClone(source);
      const result = await resolveProdRef(
        createGitRunner(git, clone.dir),
        "prod",
      );
      expect(result.source).toBe("remote");
      expect(result.ref).toBe("refs/remotes/origin/prod");
      expect(result.commit).toBe(await head(source));
    },
    TIMEOUT,
  );

  it(
    "rejects with NoProdRefError when neither ref exists",
    async () => {
      const repo = await newRepo();
      const error = await resolveProdRef(
        createGitRunner(git, repo.dir),
        "nope",
      ).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(NoProdRefError);
      if (!(error instanceof NoProdRefError)) throw error;
      expect(error.branch).toBe("nope");
      expect(error.triedRefs).toEqual([
        "refs/remotes/origin/nope",
        "refs/heads/nope",
      ]);
      expect(error.message).toContain("refs/remotes/origin/nope");
      expect(error.message).toContain("refs/heads/nope");
    },
    TIMEOUT,
  );

  it(
    "is not fooled by a local branch named origin/main or a tag named main",
    async () => {
      const source = await newRepo();
      const older = await head(source);
      await source.commit({ message: "two", files: { "b.md": "2" } });
      const tip = await head(source);
      const clone = await newClone(source);
      await clone.git(["branch", "origin/main", older]);
      await clone.git(["tag", "main", older]);

      // Controls: plain git picks the lookalikes.
      expect((await clone.git(["rev-parse", "origin/main"])).trim()).toBe(
        older,
      );
      expect((await clone.git(["rev-parse", "main"])).trim()).toBe(older);

      const result = await resolveProdRef(
        createGitRunner(git, clone.dir),
        "main",
      );
      expect(result.ref).toBe("refs/remotes/origin/main");
      expect(result.commit).toBe(tip);
    },
    TIMEOUT,
  );

  it.each(["--output=x.md", "-x", "main..x", "HEAD", "a b", ""])(
    "rejects invalid name %j before running git",
    async (name) => {
      const missing = join(tmpdir(), `no-git-${randomUUID()}`, "git");
      const runner = createGitRunner(
        { path: missing, version: git.version },
        tmpdir(),
      );
      const error = await resolveProdRef(runner, name).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(GitCommandError);
      expect(error).toHaveProperty(
        "message",
        expect.stringContaining("Invalid branch name"),
      );
    },
  );

  it(
    "rejects with GitCommandError outside a git repo",
    async () => {
      const folder = realpathSync.native(
        mkdtempSync(join(tmpdir(), "prod-ref-")),
      );
      folders.push(folder);
      const error = await resolveProdRef(
        createGitRunner(git, folder),
        "main",
      ).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(GitCommandError);
      expect(error).not.toBeInstanceOf(NoProdRefError);
    },
    TIMEOUT,
  );
});
