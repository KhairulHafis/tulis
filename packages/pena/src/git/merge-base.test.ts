import { cloneTestRepo, createTestRepo, type TestRepo } from "@tulis/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { findGit, type GitExecutable } from "./find-git.js";
import { GitCommandError, createGitRunner } from "./git-runner.js";
import { findMergeBase, resolveHead } from "./merge-base.js";

const TIMEOUT = 30_000;
let git: GitExecutable;
const repos: TestRepo[] = [];

beforeAll(async () => {
  git = await findGit();
});

afterEach(() => {
  for (const repo of repos.splice(0)) repo.cleanup();
});

async function emptyRepo(): Promise<TestRepo> {
  const repo = await createTestRepo();
  repos.push(repo);
  return repo;
}

async function head(repo: TestRepo): Promise<string> {
  return (await repo.git(["rev-parse", "HEAD"])).trim();
}

interface History {
  readonly repo: TestRepo;
  readonly c1: string;
  readonly c2: string;
  readonly c3: string;
  readonly f1: string;
}

/** main: c1, c2, c3. feature: c1, f1. Ends on main. */
async function history(): Promise<History> {
  const repo = await emptyRepo();
  const c1 = await repo.commit({ message: "c1", files: { "a.md": "1" } });
  await repo.createBranch("feature");
  const c2 = await repo.commit({ message: "c2", files: { "a.md": "2" } });
  const c3 = await repo.commit({ message: "c3", files: { "a.md": "3" } });
  await repo.checkout("feature");
  const f1 = await repo.commit({ message: "f1", files: { "b.md": "f" } });
  await repo.checkout("main");
  return { repo, c1, c2, c3, f1 };
}

describe("resolveHead", () => {
  it(
    "returns the HEAD commit and follows a branch switch",
    async () => {
      const h = await history();
      const runner = createGitRunner(git, h.repo.dir);
      expect(await resolveHead(runner)).toBe(h.c3);
      await h.repo.checkout("feature");
      expect(await resolveHead(runner)).toBe(h.f1);
    },
    TIMEOUT,
  );

  it(
    "works with a detached HEAD",
    async () => {
      const h = await history();
      await h.repo.git(["checkout", "-q", "--detach", h.c2]);
      expect(await resolveHead(createGitRunner(git, h.repo.dir))).toBe(h.c2);
    },
    TIMEOUT,
  );

  it(
    "returns undefined when there are no commits",
    async () => {
      const repo = await emptyRepo();
      expect(await resolveHead(createGitRunner(git, repo.dir))).toBeUndefined();
    },
    TIMEOUT,
  );
});

describe("findMergeBase", () => {
  it(
    "finds the fork point of two branches",
    async () => {
      const h = await history();
      const runner = createGitRunner(git, h.repo.dir);
      expect(await findMergeBase(runner, h.c3, h.f1)).toEqual({
        kind: "found",
        commit: h.c1,
      });
      expect(await findMergeBase(runner, h.f1, h.c3)).toEqual({
        kind: "found",
        commit: h.c1,
      });
    },
    TIMEOUT,
  );

  it(
    "finds the ancestor when one commit is behind the other",
    async () => {
      const h = await history();
      const runner = createGitRunner(git, h.repo.dir);
      expect(await findMergeBase(runner, h.c1, h.c3)).toEqual({
        kind: "found",
        commit: h.c1,
      });
      expect(await findMergeBase(runner, h.c3, h.c1)).toEqual({
        kind: "found",
        commit: h.c1,
      });
    },
    TIMEOUT,
  );

  it(
    "returns the commit itself when both are the same",
    async () => {
      const h = await history();
      expect(
        await findMergeBase(createGitRunner(git, h.repo.dir), h.c2, h.c2),
      ).toEqual({ kind: "found", commit: h.c2 });
    },
    TIMEOUT,
  );

  it(
    "returns none for unrelated histories",
    async () => {
      const h = await history();
      await h.repo.git(["checkout", "-q", "--orphan", "other"]);
      const orphan = await h.repo.commit({
        message: "orphan",
        files: { "o.md": "o" },
        remove: ["a.md", "b.md"],
      });
      const runner = createGitRunner(git, h.repo.dir);
      expect(await findMergeBase(runner, orphan, h.c3)).toEqual({
        kind: "none",
      });
      expect(await findMergeBase(runner, h.c3, orphan)).toEqual({
        kind: "none",
      });
    },
    TIMEOUT,
  );

  it(
    "returns none in a shallow clone where the shared commit was cut off",
    async () => {
      const h = await history();
      const clone = await cloneTestRepo(h.repo, {
        depth: 1,
        branch: "feature",
      });
      repos.push(clone);
      await clone.git([
        "fetch",
        "-q",
        "--depth",
        "1",
        "origin",
        "main:refs/remotes/origin/main",
      ]);
      const featureTip = await head(clone);
      const mainTip = (
        await clone.git(["rev-parse", "refs/remotes/origin/main"])
      ).trim();
      expect(featureTip).toBe(h.f1);
      expect(mainTip).toBe(h.c3);
      expect(
        await findMergeBase(
          createGitRunner(git, clone.dir),
          featureTip,
          mainTip,
        ),
      ).toEqual({ kind: "none" });
    },
    TIMEOUT,
  );

  it(
    "rethrows when an ID is not in the repo",
    async () => {
      const h = await history();
      const missing = "1".repeat(40);
      const error: unknown = await findMergeBase(
        createGitRunner(git, h.repo.dir),
        h.c1,
        missing,
      ).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(GitCommandError);
      if (error instanceof GitCommandError) {
        expect(error.failure).toBe("exit");
        expect(error.exitCode).toBe(128);
      }
    },
    TIMEOUT,
  );

  it(
    "rejects anything but a full lower-case object ID before running git",
    async () => {
      const h = await history();
      const runner = createGitRunner(git, h.repo.dir);
      const bad = [
        "HEAD",
        "main",
        h.c1.slice(0, 7),
        h.c1.toUpperCase(),
        "--all",
        "-",
      ];
      for (const value of bad) {
        for (const [a, b] of [
          [value, h.c1],
          [h.c1, value],
        ] as const) {
          const error: unknown = await findMergeBase(runner, a, b).catch(
            (caught: unknown) => caught,
          );
          expect(error).toBeInstanceOf(Error);
          expect(error).not.toBeInstanceOf(GitCommandError);
          if (error instanceof Error) {
            expect(error.message).toContain("Not a full object ID");
          }
        }
      }
    },
    TIMEOUT,
  );
});
