import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { cloneTestRepo, createTestRepo, type TestRepo } from "@tulis/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { findGit, type GitExecutable } from "./find-git.js";
import { buildGitEnv } from "./git-env.js";
import {
  GitCommandError,
  buildGitArgs,
  createGitRunner,
} from "./git-runner.js";

const execFileAsync = promisify(execFile);

// Security tests: each attack runs through Pena's runner (must be blocked)
// and then through plain git (the control, must work).
describe("git runner security", () => {
  let git: GitExecutable;
  let repos: TestRepo[] = [];
  let tempDirs: string[] = [];

  beforeAll(async () => {
    git = await findGit();
  });

  afterEach(() => {
    for (const repo of repos) {
      repo.cleanup();
    }
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    repos = [];
    tempDirs = [];
  });

  async function newRepo(config?: Record<string, string>): Promise<TestRepo> {
    const repo = await createTestRepo(config === undefined ? {} : { config });
    repos.push(repo);
    return repo;
  }

  function forwardSlashes(path: string): string {
    return path.replaceAll("\\", "/");
  }

  /** A command git can run that appends a line to a marker file. */
  function makeMarker(): { command: string; markerPath: string } {
    const dir = mkdtempSync(join(tmpdir(), "tulis-security-"));
    tempDirs.push(dir);
    const markerPath = join(dir, "marker.txt");
    const scriptPath = join(dir, "marker.mjs");
    writeFileSync(
      scriptPath,
      `import { appendFileSync } from "node:fs";\n` +
        `appendFileSync(${JSON.stringify(markerPath)}, "ran\\n");\n` +
        `process.stdout.write("converted");\n`,
    );
    const command = `"${forwardSlashes(process.execPath)}" "${forwardSlashes(scriptPath)}"`;
    return { command, markerPath };
  }

  async function twoCommits(repo: TestRepo): Promise<void> {
    await repo.commit({ message: "one", files: { "a.md": "one\n" } });
    await repo.commit({ message: "two", files: { "a.md": "two\n" } });
  }

  async function failureOf(promise: Promise<string>): Promise<GitCommandError> {
    try {
      await promise;
    } catch (error) {
      if (error instanceof GitCommandError) {
        return error;
      }
      throw error;
    }
    throw new Error("Expected the command to fail");
  }

  // Proves a file named like a flag is read as a path, never as an option.
  it("treats a file named like a flag as a path", async () => {
    const repo = await newRepo();
    const sha = await repo.commit({
      message: "first",
      files: { "--output=x.md": "x\n", "a.md": "a\n" },
    });
    const runner = createGitRunner(git, repo.dir);

    const log = await runner.run("log", ["--format=%H"], {
      paths: ["--output=x.md"],
    });
    expect(log.trim()).toBe(sha);
    expect(existsSync(join(repo.dir, "x.md"))).toBe(false);

    const tree = await runner.run("ls-tree", ["--name-only", "HEAD"], {
      paths: ["--output=x.md"],
    });
    expect(tree.trim()).toBe("--output=x.md");

    // Control: plain git takes the same text as an option and writes x.md.
    await repo.git(["log", "--output=x.md"]);
    expect(existsSync(join(repo.dir, "x.md"))).toBe(true);
  }, 30_000);

  // Proves a textconv program from repo config is never run.
  it("does not run a textconv program from repo config", async () => {
    const { command, markerPath } = makeMarker();
    const repo = await newRepo({ "diff.trap.textconv": command });
    await repo.commit({
      message: "attributes",
      files: { ".gitattributes": "*.md diff=trap\n" },
    });
    await twoCommits(repo);
    const runner = createGitRunner(git, repo.dir);

    await runner.run("show", ["HEAD"]);
    await runner.run("log", ["-p"]);
    await runner.run("diff-tree", ["-p", "HEAD~1", "HEAD"]);
    expect(existsSync(markerPath)).toBe(false);

    // Control: plain git runs the program.
    await repo.git(["show", "HEAD"]);
    expect(existsSync(markerPath)).toBe(true);
  }, 30_000);

  // Proves an external diff program from repo config is never run. log, show
  // and diff-tree skip external diff tools by default, so this guards against
  // a change that turns them on; --no-ext-diff is the second line of defence.
  it("does not run diff.external from repo config", async () => {
    const { command, markerPath } = makeMarker();
    const repo = await newRepo({ "diff.external": command });
    await twoCommits(repo);
    const runner = createGitRunner(git, repo.dir);

    await runner.run("show", ["HEAD"]);
    await runner.run("log", ["-p"]);
    await runner.run("diff-tree", ["-p", "HEAD~1", "HEAD"]);
    expect(existsSync(markerPath)).toBe(false);

    // Control: porcelain git diff runs the program.
    try {
      await repo.git(["diff", "HEAD~1", "HEAD"]);
    } catch {
      // The script is not a real diff tool, so git may exit non-zero.
    }
    expect(existsSync(markerPath)).toBe(true);
  }, 30_000);

  // Proves GIT_DIR and GIT_WORK_TREE from the caller's environment are ignored.
  it("ignores GIT_DIR and GIT_WORK_TREE from the caller", async () => {
    const repoA = await newRepo();
    const repoB = await newRepo();
    const shaA = await repoA.commit({
      message: "a",
      files: { "a.md": "a\n" },
    });
    const shaB = await repoB.commit({
      message: "b",
      files: { "b.md": "b\n" },
    });
    expect(shaA).not.toBe(shaB);

    const runner = createGitRunner(git, repoA.dir, {
      ...process.env,
      GIT_DIR: join(repoB.dir, ".git"),
      GIT_WORK_TREE: repoB.dir,
    });
    expect((await runner.run("rev-parse", ["HEAD"])).trim()).toBe(shaA);
  }, 30_000);

  // Proves GIT_EXTERNAL_DIFF from the caller's environment is ignored. Like
  // the diff.external test, this guards against external diffs being turned on.
  it("ignores GIT_EXTERNAL_DIFF from the caller", async () => {
    const { command, markerPath } = makeMarker();
    const repo = await newRepo();
    await twoCommits(repo);
    const runner = createGitRunner(git, repo.dir, {
      ...process.env,
      GIT_EXTERNAL_DIFF: command,
    });

    await runner.run("show", ["HEAD"]);
    await runner.run("log", ["-p"]);
    expect(existsSync(markerPath)).toBe(false);
  }, 30_000);

  // Proves GIT_CONFIG_PARAMETERS from the caller's environment is ignored.
  // It uses a harmless setting with visible output, because the hardening
  // flags would block a dangerous one even if the variable got through.
  it("ignores GIT_CONFIG_PARAMETERS from the caller", async () => {
    const repo = await newRepo();
    await twoCommits(repo);
    const args = ["-1", "--format=%h"];
    const plain = await createGitRunner(git, repo.dir).run("log", args);
    const injected = await createGitRunner(git, repo.dir, {
      ...process.env,
      GIT_CONFIG_PARAMETERS: "'core.abbrev'='20'",
    }).run("log", args);
    expect(injected).toBe(plain);
    expect(plain.trim().length).toBeLessThan(20);
  }, 30_000);

  // Proves a partial clone never downloads missing objects.
  it("never downloads objects in a partial clone", async () => {
    const source = await newRepo();
    await source.commit({ message: "one", files: { "a.md": "one\n" } });
    await source.commit({ message: "two", files: { "a.md": "two\n" } });
    const clone = await cloneTestRepo(source, { partial: true });
    repos.push(clone);
    // An untrusted repo can allow the file transport in its own config.
    await clone.git(["config", "protocol.file.allow", "always"]);

    const oldBlob = (await clone.git(["rev-parse", "HEAD~1:a.md"])).trim();
    const countMissing = async (repo: TestRepo): Promise<number> => {
      const out = await repo.git([
        "rev-list",
        "--objects",
        "--all",
        "--missing=print",
      ]);
      return out.split(/\r?\n/).filter((line) => line.startsWith("?")).length;
    };
    const missingBefore = await countMissing(clone);
    expect(missingBefore).toBeGreaterThanOrEqual(1);

    const runner = createGitRunner(git, clone.dir);
    const attacks: [Parameters<typeof runner.run>[0], string[]][] = [
      ["cat-file", ["-p", oldBlob]],
      ["show", ["HEAD~1:a.md"]],
      ["log", ["-p"]],
    ];
    for (const [command, args] of attacks) {
      const error = await failureOf(runner.run(command, args));
      expect(error.failure).toBe("exit");
      expect(await countMissing(clone)).toBe(missingBefore);
    }

    // Without GIT_NO_LAZY_FETCH (git before 2.44), the transport block alone
    // must still stop the download.
    const env = Object.fromEntries(
      Object.entries(buildGitEnv(process.env)).filter(
        ([key]) => key !== "GIT_NO_LAZY_FETCH",
      ),
    );
    await expect(
      execFileAsync(git.path, buildGitArgs("cat-file", ["-p", oldBlob]), {
        cwd: clone.dir,
        env,
      }),
    ).rejects.toThrow();
    expect(await countMissing(clone)).toBe(missingBefore);

    // Control: plain git downloads the blob.
    expect(await clone.git(["cat-file", "-p", oldBlob])).toBe("one\n");
    expect(await countMissing(clone)).toBeLessThan(missingBefore);
  }, 30_000);

  // Proves terminal escape codes in git's stderr are made safe.
  it("removes terminal escape codes from git's stderr", async () => {
    const repo = await newRepo();
    await repo.commit({ message: "first", files: { "a.md": "a\n" } });
    const runner = createGitRunner(git, repo.dir);

    // Without a "--" git quietly treats the unknown name as a path and exits 0,
    // so a path is passed to make the runner add the "--".
    const error = await failureOf(
      runner.run("show", ["HEAD:\u001b[31mred.md"], { paths: ["a.md"] }),
    );
    expect(error.message).not.toContain("\u001b");
    expect(error.stderr).not.toContain("\u001b");
    expect(error.stderr).toContain("?[31m");
  }, 30_000);
});
