import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  TEST_AUTHOR_EMAIL,
  TEST_AUTHOR_NAME,
  buildSandboxArgs,
  buildSandboxEnv,
  runGit,
  type GitSandbox,
} from "./run-git.js";

const sandbox: GitSandbox = { homeDir: join("x", "home"), ceilingDir: "x" };
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("buildSandboxEnv", () => {
  it("removes GIT_* variables in any case and keeps the rest", () => {
    const env = buildSandboxEnv(
      {
        PATH: "/bin",
        GIT_DIR: "/bogus",
        git_dir: "/bogus2",
        GIT_CONFIG_PARAMETERS: "'a=b'",
        OTHER: "1",
      },
      sandbox,
    );
    expect(env["PATH"]).toBe("/bin");
    expect(env["OTHER"]).toBe("1");
    expect(env["GIT_DIR"]).toBeUndefined();
    expect(env["git_dir"]).toBeUndefined();
    expect(env["GIT_CONFIG_PARAMETERS"]).toBeUndefined();
  });

  it("sets every sandbox variable", () => {
    const env = buildSandboxEnv({}, sandbox);
    expect(env["HOME"]).toBe(sandbox.homeDir);
    expect(env["USERPROFILE"]).toBe(sandbox.homeDir);
    expect(env["XDG_CONFIG_HOME"]).toBe(sandbox.homeDir);
    expect(env["GIT_CONFIG_NOSYSTEM"]).toBe("1");
    expect(env["GIT_CONFIG_GLOBAL"]).toBe(join(sandbox.homeDir, ".gitconfig"));
    expect(env["GIT_CEILING_DIRECTORIES"]).toBe(sandbox.ceilingDir);
    expect(env["GIT_TERMINAL_PROMPT"]).toBe("0");
    expect(env["GIT_AUTHOR_NAME"]).toBe(TEST_AUTHOR_NAME);
    expect(env["GIT_COMMITTER_NAME"]).toBe(TEST_AUTHOR_NAME);
    expect(env["GIT_AUTHOR_EMAIL"]).toBe(TEST_AUTHOR_EMAIL);
    expect(env["GIT_COMMITTER_EMAIL"]).toBe(TEST_AUTHOR_EMAIL);
    expect(env["GIT_AUTHOR_DATE"]).toBeUndefined();
    expect(env["GIT_COMMITTER_DATE"]).toBeUndefined();
  });

  it("sets both date variables when a date is given", () => {
    const env = buildSandboxEnv({}, sandbox, new Date("2026-01-02T00:00:00Z"));
    expect(env["GIT_AUTHOR_DATE"]).toBe("1767312000 +0000");
    expect(env["GIT_COMMITTER_DATE"]).toBe("1767312000 +0000");
  });
});

describe("buildSandboxArgs", () => {
  it("puts the flags before the caller's args", () => {
    expect(buildSandboxArgs(["status", "-s"])).toEqual([
      "--no-pager",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "protocol.allow=never",
      "-c",
      "protocol.file.allow=always",
      "status",
      "-s",
    ]);
  });
});

describe("runGit", () => {
  it("rejects with the subcommand and git's stderr", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "tulis-rungit-")));
    roots.push(root);
    const homeDir = join(root, "home");
    const dir = join(root, "repo");
    mkdirSync(homeDir);
    mkdirSync(dir);
    writeFileSync(join(homeDir, ".gitconfig"), "");
    const box: GitSandbox = { homeDir, ceilingDir: root };
    await runGit(["init", "-q"], dir, box);
    const failure = runGit(["rev-parse", "--verify", "no-such-ref"], dir, box);
    await expect(failure).rejects.toThrow(/rev-parse --verify no-such-ref/);
    await expect(failure).rejects.toThrow(/no-such-ref/i);
  }, 30_000);
});
