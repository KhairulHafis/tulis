import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Corpus } from "./corpus-list.ts";
import {
  buildGitArgs,
  buildGitEnv,
  createGitRunner,
  fetchAllCorpora,
  fetchCorpus,
  type GitRunner,
} from "./fetch-corpus.ts";

const TEST_TIMEOUT_MS = 30_000;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function commitAll(cwd: string, message: string): string {
  git(cwd, "add", "-A");
  git(
    cwd,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "-m",
    message,
  );
  return git(cwd, "rev-parse", "HEAD");
}

describe("buildGitArgs", () => {
  it("puts the hardening flags before the caller's args", () => {
    expect(buildGitArgs(["status"], ["https"])).toEqual([
      "--no-pager",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.symlinks=false",
      "-c",
      "protocol.allow=never",
      "-c",
      "protocol.https.allow=always",
      "status",
    ]);
  });

  it("rejects an invalid protocol name", () => {
    expect(() => buildGitArgs(["status"], ["ht tp"])).toThrow(/protocol/);
    expect(() => buildGitArgs(["status"], ["https=always -c x"])).toThrow();
  });
});

describe("buildGitEnv", () => {
  it("drops GIT_ variables, keeps others, sets the two safety variables", () => {
    const input: NodeJS.ProcessEnv = {
      GIT_DIR: "/somewhere",
      git_ssh_command: "evil",
      PATH: "/bin",
    };
    const result = buildGitEnv(input);
    expect(result["GIT_DIR"]).toBeUndefined();
    expect(result["git_ssh_command"]).toBeUndefined();
    expect(result["PATH"]).toBe("/bin");
    expect(result["GIT_TERMINAL_PROMPT"]).toBe("0");
    expect(result["GIT_LFS_SKIP_SMUDGE"]).toBe("1");
    expect(input).toEqual({
      GIT_DIR: "/somewhere",
      git_ssh_command: "evil",
      PATH: "/bin",
    });
  });
});

describe("fetchCorpus", () => {
  let tmp = "";
  let sourceDir = "";
  let cacheDir = "";
  let commit1 = "";
  let commit2 = "";

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "tulis-fetch-"));
    sourceDir = join(tmp, "source");
    cacheDir = join(tmp, "cache");
    mkdirSync(sourceDir);
    mkdirSync(cacheDir);
    git(sourceDir, "init", "--quiet", "--initial-branch=main");
    git(sourceDir, "config", "uploadpack.allowFilter", "true");
    mkdirSync(join(sourceDir, "docs"));
    mkdirSync(join(sourceDir, "other"));
    writeFileSync(join(sourceDir, "docs", "a.md"), "one");
    writeFileSync(join(sourceDir, "other", "b.md"), "other");
    commit1 = commitAll(sourceDir, "one");
    writeFileSync(join(sourceDir, "docs", "a.md"), "two");
    commit2 = commitAll(sourceDir, "two");
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function corpus(overrides: Partial<Corpus> = {}): Corpus {
    return {
      name: "sample",
      url: pathToFileURL(sourceDir).href,
      branch: "main",
      commit: commit1,
      docsPath: "docs",
      ...overrides,
    };
  }

  const fileRunner = createGitRunner({ allowedProtocols: ["file"] });

  function recordingRunner(calls: string[][]): GitRunner {
    return (args, cwd, timeoutMs) => {
      calls.push([...args]);
      return fileRunner(args, cwd, timeoutMs);
    };
  }

  it(
    "downloads only the docs folder at the pinned commit",
    async () => {
      const outcome = await fetchCorpus(corpus(), cacheDir, fileRunner);
      const repoDir = join(cacheDir, "sample");
      expect(outcome).toBe("fetched");
      expect(git(repoDir, "rev-parse", "HEAD")).toBe(commit1);
      expect(readFileSync(join(repoDir, "docs", "a.md"), "utf8").trim()).toBe(
        "one",
      );
      expect(existsSync(join(repoDir, "other", "b.md"))).toBe(false);
      expect(git(repoDir, "rev-parse", "refs/heads/main")).toBe(commit1);
      expect(git(repoDir, "rev-parse", "refs/remotes/origin/main")).toBe(
        commit1,
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "does nothing on a second run",
    async () => {
      await fetchCorpus(corpus(), cacheDir, fileRunner);
      const calls: string[][] = [];
      const outcome = await fetchCorpus(
        corpus(),
        cacheDir,
        recordingRunner(calls),
      );
      expect(outcome).toBe("up-to-date");
      const subcommands = calls.map((args) => args[0]);
      expect(subcommands).not.toContain("fetch");
      expect(subcommands).not.toContain("checkout");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "moves to a new pinned commit",
    async () => {
      await fetchCorpus(corpus(), cacheDir, fileRunner);
      const outcome = await fetchCorpus(
        corpus({ commit: commit2 }),
        cacheDir,
        fileRunner,
      );
      expect(outcome).toBe("fetched");
      const repoDir = join(cacheDir, "sample");
      expect(git(repoDir, "rev-parse", "HEAD")).toBe(commit2);
      expect(readFileSync(join(repoDir, "docs", "a.md"), "utf8").trim()).toBe(
        "two",
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "re-checks out when the docs path changes",
    async () => {
      await fetchCorpus(corpus(), cacheDir, fileRunner);
      const outcome = await fetchCorpus(
        corpus({ docsPath: "other" }),
        cacheDir,
        fileRunner,
      );
      expect(outcome).toBe("fetched");
      const repoDir = join(cacheDir, "sample");
      expect(readFileSync(join(repoDir, "other", "b.md"), "utf8").trim()).toBe(
        "other",
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "logs fetched lines, then already-at lines",
    async () => {
      const corpora = [corpus({ name: "first" }), corpus({ name: "second" })];
      const short = commit1.slice(0, 7);

      const firstLog: string[] = [];
      await fetchAllCorpora(corpora, cacheDir, fileRunner, (line) =>
        firstLog.push(line),
      );
      expect(firstLog).toEqual([
        `first: fetching ${short}, docs only (docs)`,
        `first: fetched ${short}`,
        `second: fetching ${short}, docs only (docs)`,
        `second: fetched ${short}`,
      ]);

      const secondLog: string[] = [];
      await fetchAllCorpora(corpora, cacheDir, fileRunner, (line) =>
        secondLog.push(line),
      );
      expect(secondLog).toEqual([
        `first: already at ${short}`,
        `second: already at ${short}`,
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuses a folder that is not a git repository",
    async () => {
      const repoDir = join(cacheDir, "sample");
      mkdirSync(repoDir);
      writeFileSync(join(repoDir, "keep.txt"), "keep");
      await expect(fetchCorpus(corpus(), cacheDir, fileRunner)).rejects.toThrow(
        /not a git repository/,
      );
      expect(readdirSync(repoDir)).toEqual(["keep.txt"]);
      expect(readFileSync(join(repoDir, "keep.txt"), "utf8")).toBe("keep");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "never follows a symbolic link at the corpus path",
    async () => {
      const target = join(tmp, "target");
      mkdirSync(target);
      symlinkSync(target, join(cacheDir, "sample"), "junction");
      await expect(fetchCorpus(corpus(), cacheDir, fileRunner)).rejects.toThrow(
        /symbolic link/,
      );
      expect(readdirSync(target)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuses a file:// source with the default runner",
    async () => {
      await expect(
        fetchCorpus(corpus(), cacheDir, createGitRunner()),
      ).rejects.toThrow(/not allowed/i);
    },
    TEST_TIMEOUT_MS,
  );
});
