import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { cloneTestRepo, createTestRepo, type TestRepo } from "@tulis/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { findGit, type GitExecutable } from "./find-git.js";
import {
  GIT_COMMANDS,
  GIT_CONFIG_QUERIES,
  GitCommandError,
  buildGitArgs,
  buildStopCommand,
  createGitRunner,
  isGitCommand,
  type GitCommand,
} from "./git-runner.js";

const HARDENING = [
  "--no-pager",
  "--no-replace-objects",
  "--literal-pathspecs",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "protocol.allow=never",
];

function build(command: GitCommand, args: string[], paths?: string[]) {
  return buildGitArgs(command, args, paths);
}

describe("buildGitArgs", () => {
  it("builds the full list for rev-parse", () => {
    expect(build("rev-parse", ["HEAD"])).toEqual([
      "--no-pager",
      "--no-replace-objects",
      "--literal-pathspecs",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "protocol.allow=never",
      "rev-parse",
      "HEAD",
    ]);
  });

  it("adds the diff flags only to diff-tree, log and show", () => {
    const diffCommands = ["diff-tree", "log", "show"];
    for (const command of GIT_COMMANDS) {
      const result = build(
        command,
        command === "config"
          ? [...GIT_CONFIG_QUERIES.partialCloneExtension]
          : ["x"],
      );
      if (diffCommands.includes(command)) {
        expect(result.slice(7, 10)).toEqual([
          command,
          "--no-ext-diff",
          "--no-textconv",
        ]);
      } else {
        expect(result).not.toContain("--no-ext-diff");
        expect(result).not.toContain("--no-textconv");
      }
    }
  });

  it("starts with the hardening items for every command", () => {
    for (const command of GIT_COMMANDS) {
      const args =
        command === "config"
          ? [...GIT_CONFIG_QUERIES.partialCloneExtension]
          : [];
      expect(build(command, args).slice(0, 7)).toEqual(HARDENING);
    }
  });

  it("adds --literal-pathspecs before the command for every command", () => {
    for (const command of GIT_COMMANDS) {
      const args =
        command === "config"
          ? [...GIT_CONFIG_QUERIES.partialCloneExtension]
          : [];
      const result = build(command, args);
      const flagIndex = result.indexOf("--literal-pathspecs");
      expect(flagIndex).toBeGreaterThanOrEqual(0);
      expect(flagIndex).toBeLessThan(result.indexOf(command));
    }
  });

  it("puts paths after a single -- at the end", () => {
    const result = build("ls-tree", ["HEAD"], ["a.md", "--output=x.md"]);
    expect(result.filter((arg) => arg === "--")).toHaveLength(1);
    expect(result.slice(-3)).toEqual(["--", "a.md", "--output=x.md"]);
  });

  it("adds no -- for empty paths", () => {
    expect(build("ls-tree", ["HEAD"], [])).not.toContain("--");
  });

  it("throws for -- in args", () => {
    expect(() => build("log", ["--"])).toThrow(
      'Pass file paths in "paths", not after "--" in args',
    );
  });

  it("throws for NUL in an arg or a path", () => {
    expect(() => build("log", ["a\0b"])).toThrow(
      "Git arguments must not contain NUL characters",
    );
    expect(() => build("log", [], ["a\0b"])).toThrow(
      "Git arguments must not contain NUL characters",
    );
  });

  it("recognises git commands", () => {
    expect(isGitCommand("push")).toBe(false);
    expect(isGitCommand("log")).toBe(true);
  });

  it("throws at runtime for an unknown command", () => {
    expect(() => {
      Reflect.apply(buildGitArgs, undefined, ["push", []]);
    }).toThrow('Unknown git command "push"');
  });
});

const CONFIG_REFUSED =
  "git config is allowed only for Tulis's fixed read-only lookups";

describe("buildGitArgs config", () => {
  it("accepts each fixed query and keeps it unchanged", () => {
    for (const query of Object.values(GIT_CONFIG_QUERIES)) {
      const result = build("config", [...query]);
      expect(result.slice(result.indexOf("config") + 1)).toEqual([...query]);
      expect(result).not.toContain("--no-ext-diff");
      expect(result).not.toContain("--no-textconv");
    }
  });

  it("refuses every other form with a message that hides the arguments", () => {
    const [ext, remotes] = [
      GIT_CONFIG_QUERIES.partialCloneExtension,
      GIT_CONFIG_QUERIES.promisorRemotes,
    ];
    const refused: string[][] = [
      [],
      ["extensions.partialclone", "evil"],
      ["--get", "extensions.partialclone"],
      ["-z", "--get", "core.secretkey"],
      ["-z", "--get", "extensions.partialclone", "extra"],
      [...ext, "--unset"],
      ["--unset", "extensions.partialclone"],
      ["--add", "extensions.partialclone", "evil"],
      ["--replace-all", "extensions.partialclone", "evil"],
      ["--edit"],
      ["--file", "evil.cfg", "--get", "extensions.partialclone"],
      ["--global", ...ext],
      ["--system", ...remotes],
      [...remotes].reverse(),
      [...remotes.slice(0, 3)],
      ["-z", "--get", "EXTENSIONS.PARTIALCLONE"],
    ];
    for (const args of refused) {
      expect(() => build("config", args)).toThrow(CONFIG_REFUSED);
      try {
        build("config", args);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        const message = error instanceof Error ? error.message : "";
        expect(message).toBe(CONFIG_REFUSED);
        expect(message).not.toContain("evil");
        expect(message).not.toContain("secretkey");
      }
    }
  });

  it("refuses a fixed query when paths are given", () => {
    expect(() =>
      build("config", [...GIT_CONFIG_QUERIES.partialCloneExtension], ["a.md"]),
    ).toThrow(CONFIG_REFUSED);
  });
});

describe("buildStopCommand", () => {
  const args = ["/PID", "1234", "/T", "/F"];

  it("uses taskkill under SystemRoot on win32", () => {
    expect(
      buildStopCommand(1234, "win32", { SystemRoot: "C:\\Windows" }),
    ).toEqual({ file: "C:\\Windows\\System32\\taskkill.exe", args });
  });

  it("matches the SystemRoot key case-insensitively", () => {
    expect(buildStopCommand(1234, "win32", { SYSTEMROOT: "D:\\Win" })).toEqual({
      file: "D:\\Win\\System32\\taskkill.exe",
      args,
    });
  });

  it("falls back to C:\\Windows for a missing, empty or relative root", () => {
    const expected = {
      file: "C:\\Windows\\System32\\taskkill.exe",
      args,
    };
    expect(buildStopCommand(1234, "win32", {})).toEqual(expected);
    expect(buildStopCommand(1234, "win32", { SystemRoot: "" })).toEqual(
      expected,
    );
    expect(buildStopCommand(1234, "win32", { SystemRoot: "Windows" })).toEqual(
      expected,
    );
  });

  it("returns undefined on other platforms", () => {
    expect(buildStopCommand(1234, "linux", {})).toBeUndefined();
    expect(buildStopCommand(1234, "darwin", {})).toBeUndefined();
  });
});

describe("createGitRunner", () => {
  it("throws for a relative repoDir", () => {
    const git: GitExecutable = {
      path: "git",
      version: { major: 2, minor: 50, patch: 0 },
    };
    expect(() => createGitRunner(git, "relative/dir")).toThrow();
  });
});

describe("GitRunner.run", () => {
  let git: GitExecutable;
  let repo: TestRepo | undefined;
  let extraRepos: TestRepo[] = [];

  beforeAll(async () => {
    git = await findGit();
  });

  afterEach(() => {
    repo?.cleanup();
    repo = undefined;
    for (const extra of extraRepos) {
      extra.cleanup();
    }
    extraRepos = [];
  });

  async function setup(): Promise<{
    runner: ReturnType<typeof createGitRunner>;
    sha: string;
  }> {
    repo = await createTestRepo();
    const sha = await repo.commit({
      message: "first",
      files: { "a.md": "hello\n" },
    });
    return { runner: createGitRunner(git, repo.dir), sha };
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

  it("rev-parse HEAD returns the commit SHA", async () => {
    const { runner, sha } = await setup();
    expect((await runner.run("rev-parse", ["HEAD"])).trim()).toBe(sha);
  }, 30_000);

  it("ls-tree lists a path given in paths", async () => {
    const { runner } = await setup();
    const out = await runner.run("ls-tree", ["--name-only", "HEAD"], {
      paths: ["a.md"],
    });
    expect(out.trim()).toBe("a.md");
  }, 30_000);

  it("reports a non-zero exit", async () => {
    const { runner } = await setup();
    const error = await failureOf(
      runner.run("rev-parse", ["--verify", "--quiet", "refs/heads/missing"]),
    );
    expect(error.failure).toBe("exit");
    expect(error.exitCode).toBe(1);
    expect(error.name).toBe("GitCommandError");
    expect(
      error.message.startsWith("git rev-parse failed with exit code 1"),
    ).toBe(true);
  }, 30_000);

  it("includes cleaned stderr for show of a missing file", async () => {
    const { runner } = await setup();
    const error = await failureOf(runner.run("show", ["HEAD:missing.md"]));
    expect(error.failure).toBe("exit");
    expect(error.stderr).not.toBe("");
    expect(error.message.startsWith("git show failed")).toBe(true);
  }, 30_000);

  it("stops a command that runs too long", async () => {
    const { runner } = await setup();
    const error = await failureOf(
      runner.run("cat-file", ["--batch"], { timeoutMs: 500 }),
    );
    expect(error.failure).toBe("timeout");
    expect(error.message).toBe(
      "git cat-file took longer than 500 ms and was stopped.",
    );
    // The whole git process tree must be gone, or Windows keeps the folder locked.
    expect(() => {
      repo?.cleanup();
    }).not.toThrow();
    expect(existsSync(runner.repoDir)).toBe(false);
  }, 30_000);

  it("stops a command with too much output", async () => {
    const { runner } = await setup();
    const error = await failureOf(
      runner.run("log", ["--format=%H%n%H%n%H"], { maxOutputBytes: 10 }),
    );
    expect(error.failure).toBe("output-too-large");
  }, 30_000);

  it("reports a git program that cannot start", async () => {
    const { runner } = await setup();
    const missing = createGitRunner(
      {
        path: join(tmpdir(), `no-such-git-${randomUUID()}`),
        version: { major: 2, minor: 50, patch: 0 },
      },
      runner.repoDir,
    );
    const error = await failureOf(missing.run("rev-parse", ["HEAD"]));
    expect(error.failure).toBe("spawn");
  }, 30_000);

  it("rejects bad limits before running", async () => {
    const { runner } = await setup();
    await expect(
      runner.run("rev-parse", ["HEAD"], { timeoutMs: 0 }),
    ).rejects.toThrow("timeoutMs must be an integer of 1 or more");
    await expect(
      runner.run("rev-parse", ["HEAD"], { maxOutputBytes: 1.5 }),
    ).rejects.toThrow("maxOutputBytes must be an integer of 1 or more");
    await expect(runner.run("log", ["--"])).rejects.toThrow(
      'Pass file paths in "paths", not after "--" in args',
    );
  }, 30_000);

  it("refuses a config write before starting git", async () => {
    const { runner } = await setup();
    const args = ["extensions.partialclone", "evil"];
    expect(() => build("config", args)).toThrow(CONFIG_REFUSED);
    await expect(runner.run("config", args)).rejects.toThrow(CONFIG_REFUSED);
    expect(() => runner.start("config", args)).toThrow(CONFIG_REFUSED);
    expect(
      await repo
        ?.git(["config", "--get", "extensions.partialclone"])
        .catch(() => ""),
    ).toBe("");
  }, 30_000);

  it("config lookups fail with exit 1 in a normal repo", async () => {
    const { runner } = await setup();
    for (const query of Object.values(GIT_CONFIG_QUERIES)) {
      const error = await failureOf(runner.run("config", [...query]));
      expect(error.failure).toBe("exit");
      expect(error.exitCode).toBe(1);
    }
  }, 30_000);

  it("config lookups find a partial clone", async () => {
    await setup();
    if (repo === undefined) {
      throw new Error("no repo");
    }
    const clone = await cloneTestRepo(repo, { partial: true });
    extraRepos.push(clone);
    const cloneRunner = createGitRunner(git, clone.dir);
    // Modern git marks a partial clone with the promisor setting only.
    const extension = await failureOf(
      cloneRunner.run("config", [...GIT_CONFIG_QUERIES.partialCloneExtension]),
    );
    expect(extension.exitCode).toBe(1);
    const remotes = await cloneRunner.run("config", [
      ...GIT_CONFIG_QUERIES.promisorRemotes,
    ]);
    expect(remotes).toContain("remote.origin.promisor");
    expect(remotes).toContain("true");
  }, 30_000);

  it("config reads extensions.partialclone when it is set", async () => {
    const { runner } = await setup();
    await repo?.git(["config", "extensions.partialclone", "origin"]);
    expect(
      await runner.run("config", [...GIT_CONFIG_QUERIES.partialCloneExtension]),
    ).toContain("origin");
  }, 30_000);
});
