import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestRepo, type TestRepo } from "@tulis/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { findGit, type GitExecutable } from "./find-git.js";
import { createGitRunner, type GitRunner } from "./git-runner.js";
import { readFileAtCommit } from "./read-at-commit.js";

const T = 30_000;

describe("readFileAtCommit security", () => {
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

  async function newRepo(): Promise<TestRepo> {
    const repo = await createTestRepo();
    repos.push(repo);
    return repo;
  }

  async function readText(
    runner: GitRunner,
    commit: string,
    path: string,
  ): Promise<string> {
    const result = await readFileAtCommit(runner, commit, path);
    if (result.kind !== "content") {
      throw new Error(`Expected content, got ${result.kind}`);
    }
    return result.content.toString("utf8");
  }

  /** A real runner that counts how often git would start. */
  function countingRunner(dir: string): {
    runner: GitRunner;
    runCount: () => number;
  } {
    let runs = 0;
    const real = createGitRunner(git, dir);
    const runner: GitRunner = {
      ...real,
      run: (...args) => {
        runs += 1;
        return real.run(...args);
      },
      start: (...args) => {
        runs += 1;
        return real.start(...args);
      },
    };
    return { runner, runCount: () => runs };
  }

  function forwardSlashes(path: string): string {
    return path.replaceAll("\\", "/");
  }

  it(
    "reads a file named like an option",
    async () => {
      const repo = await newRepo();
      const commit = await repo.commit({
        message: "one",
        files: { "--output=x.md": "odd name\n" },
      });

      const text = await readText(
        createGitRunner(git, repo.dir),
        commit,
        "--output=x.md",
      );
      expect(text).toBe("odd name\n");
      expect(readdirSync(repo.dir)).not.toContain("x.md");
    },
    T,
  );

  it(
    "never treats a path as a glob",
    async () => {
      const repo = await newRepo();
      const commit = await repo.commit({
        message: "one",
        files: { "a.md": "A\n", "b.md": "B\n", "[ab].md": "literal\n" },
      });

      const text = await readText(
        createGitRunner(git, repo.dir),
        commit,
        "[ab].md",
      );
      expect(text).toBe("literal\n");
    },
    T,
  );

  it(
    "rejects unsafe paths before running git",
    async () => {
      const repo = await newRepo();
      const commit = await repo.commit({
        message: "one",
        files: { "a.md": "A\n" },
      });
      const { runner, runCount } = countingRunner(repo.dir);

      for (const path of [
        "",
        "../x.md",
        "d/../a.md",
        ".git/config",
        ".GIT/config",
        "/abs.md",
        "a\\b.md",
        "a//b.md",
        "a\0b",
      ]) {
        await expect(readFileAtCommit(runner, commit, path)).rejects.toThrow(
          "Unsafe path",
        );
      }
      expect(runCount()).toBe(0);
    },
    T,
  );

  it(
    "rejects a commit that is not a full object ID before running git",
    async () => {
      const repo = await newRepo();
      const commit = await repo.commit({
        message: "one",
        files: { "a.md": "A\n" },
      });
      const { runner, runCount } = countingRunner(repo.dir);

      for (const bad of ["HEAD", commit.slice(0, 7), "--output=x"]) {
        await expect(readFileAtCommit(runner, bad, "a.md")).rejects.toThrow(
          "Not a full object ID",
        );
      }
      expect(runCount()).toBe(0);
      expect(existsSync(join(repo.dir, "x"))).toBe(false);
    },
    T,
  );

  it(
    "does not run a textconv program",
    async () => {
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

      const repo = await newRepo();
      await repo.commit({ message: "doc", files: { "a.md": "raw content\n" } });
      const commit = await repo.commit({
        message: "attributes",
        files: { ".gitattributes": "*.md diff=evil\n" },
      });
      await repo.git(["config", "diff.evil.textconv", command]);

      const text = await readText(
        createGitRunner(git, repo.dir),
        commit,
        "a.md",
      );
      expect(text).toBe("raw content\n");
      expect(existsSync(markerPath)).toBe(false);

      // Control: plain git with --textconv runs the program.
      await repo.git(["show", "--textconv", `${commit}:a.md`]);
      expect(existsSync(markerPath)).toBe(true);
    },
    T,
  );
});
