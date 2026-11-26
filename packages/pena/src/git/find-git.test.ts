import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findGit,
  GitSetupError,
  isSupportedGitVersion,
  parseGitVersion,
  resolveGitPath,
} from "./find-git.js";

const isWindows = process.platform === "win32";
const gitName = isWindows ? "git.exe" : "git";

const NOT_FOUND_MESSAGE =
  "Tulis needs Git 2.25 or later, but git was not found on PATH. Install Git, or set TULIS_GIT to the full path of the git program.";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "tulis-find-git-"));
  tempDirs.push(dir);
  return dir;
}

// A folder under the current folder, so a relative path to it exists on every
// platform (on Windows CI the temp folder is on another drive).
function makeDirUnderCwd(): string {
  const parent = join(process.cwd(), ".cache");
  mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(join(parent, "tulis-find-git-"));
  tempDirs.push(dir);
  return dir;
}

function makeDirWithGit(dir = makeDir()): { dir: string; git: string } {
  const git = join(dir, gitName);
  writeFileSync(git, "fake");
  if (!isWindows) {
    chmodSync(git, 0o755);
  }
  return { dir, git };
}

function makeScript(body: string): string {
  const dir = makeDir();
  const file = join(dir, "fake-git");
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

function catchError(run: () => unknown): GitSetupError {
  try {
    run();
  } catch (error) {
    if (error instanceof GitSetupError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected GitSetupError");
}

async function catchAsyncError(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("Expected an error");
}

describe("parseGitVersion", () => {
  it("reads real version strings", () => {
    expect(parseGitVersion("git version 2.50.1 (Apple Git-155)")).toEqual({
      major: 2,
      minor: 50,
      patch: 1,
    });
    expect(parseGitVersion("git version 2.45.1.windows.1")).toEqual({
      major: 2,
      minor: 45,
      patch: 1,
    });
    expect(parseGitVersion("git version 2.25.0")).toEqual({
      major: 2,
      minor: 25,
      patch: 0,
    });
    expect(parseGitVersion("git version 2.39.2.vfs.0.0")).toEqual({
      major: 2,
      minor: 39,
      patch: 2,
    });
  });

  it("gives patch 0 when there is no patch number", () => {
    expect(parseGitVersion("git version 2.25")).toEqual({
      major: 2,
      minor: 25,
      patch: 0,
    });
  });

  it("uses the first line only", () => {
    expect(parseGitVersion("git version 2.30.1\nsecond line\n")).toEqual({
      major: 2,
      minor: 30,
      patch: 1,
    });
    expect(parseGitVersion("git version 2.30.1\r\nsecond")?.minor).toBe(30);
  });

  it("rejects unrecognised output", () => {
    expect(parseGitVersion("")).toBeUndefined();
    expect(parseGitVersion("hello")).toBeUndefined();
    expect(parseGitVersion("git version x.y")).toBeUndefined();
    expect(parseGitVersion("Git version 2.30.0")).toBeUndefined();
    expect(parseGitVersion("hello\ngit version 2.30.0")).toBeUndefined();
  });

  it("rejects a first line longer than 200 characters", () => {
    const long = "git version 2.30.0 " + "x".repeat(182);
    expect(long).toHaveLength(201);
    expect(parseGitVersion(long)).toBeUndefined();
    expect(parseGitVersion(long.slice(0, 200))).toBeDefined();
  });
});

describe("isSupportedGitVersion", () => {
  it("accepts 2.25.0 and newer", () => {
    expect(isSupportedGitVersion({ major: 2, minor: 25, patch: 0 })).toBe(true);
    expect(isSupportedGitVersion({ major: 2, minor: 50, patch: 1 })).toBe(true);
    expect(isSupportedGitVersion({ major: 3, minor: 0, patch: 0 })).toBe(true);
  });

  it("rejects older versions", () => {
    expect(isSupportedGitVersion({ major: 2, minor: 24, patch: 9 })).toBe(
      false,
    );
    expect(isSupportedGitVersion({ major: 1, minor: 99, patch: 0 })).toBe(
      false,
    );
  });
});

describe("resolveGitPath", () => {
  it("finds git through PATH", () => {
    const { dir, git } = makeDirWithGit();
    expect(resolveGitPath({ env: { PATH: dir } })).toBe(git);
  });

  it("picks the first folder that has git", () => {
    const first = makeDirWithGit();
    const second = makeDirWithGit();
    const env = { PATH: [first.dir, second.dir].join(delimiter) };
    expect(resolveGitPath({ env })).toBe(first.git);
  });

  it("skips a relative PATH entry even when it holds a git file", () => {
    const relativeHolder = makeDirWithGit(makeDirUnderCwd());
    const absoluteHolder = makeDirWithGit();
    const relativeEntry = relative(process.cwd(), relativeHolder.dir);
    expect(isAbsolute(relativeEntry)).toBe(false);
    const env = {
      PATH: [relativeEntry, absoluteHolder.dir].join(delimiter),
    };
    expect(resolveGitPath({ env })).toBe(absoluteHolder.git);
  });

  it("skips an empty PATH entry", () => {
    const { dir, git } = makeDirWithGit();
    const env = { PATH: ["", dir].join(delimiter) };
    expect(resolveGitPath({ env })).toBe(git);
  });

  it("skips a folder whose git is a directory", () => {
    const bad = makeDir();
    mkdirSync(join(bad, gitName));
    const good = makeDirWithGit();
    const env = { PATH: [bad, good.dir].join(delimiter) };
    expect(resolveGitPath({ env })).toBe(good.git);
  });

  it.skipIf(isWindows)(
    "skips a git file without execute permission (Windows has no execute bit)",
    () => {
      const bad = makeDir();
      const badGit = join(bad, "git");
      writeFileSync(badGit, "fake");
      chmodSync(badGit, 0o644);
      const good = makeDirWithGit();
      const env = { PATH: [bad, good.dir].join(delimiter) };
      expect(resolveGitPath({ env })).toBe(good.git);
    },
  );

  it.runIf(isWindows)("finds git through a key spelled Path", () => {
    const { dir, git } = makeDirWithGit();
    expect(resolveGitPath({ env: { Path: dir } })).toBe(git);
  });

  it.runIf(isWindows)("finds git through a quoted PATH entry", () => {
    const { dir, git } = makeDirWithGit();
    expect(resolveGitPath({ env: { PATH: `"${dir}"` } })).toBe(git);
  });

  it("lets TULIS_GIT win over PATH", () => {
    const onPath = makeDirWithGit();
    const chosen = makeDirWithGit();
    const env = { PATH: onPath.dir, TULIS_GIT: chosen.git };
    expect(resolveGitPath({ env })).toBe(chosen.git);
  });

  it("lets gitPath win over TULIS_GIT", () => {
    const fromEnv = makeDirWithGit();
    const chosen = makeDirWithGit();
    const env = { TULIS_GIT: fromEnv.git };
    expect(resolveGitPath({ env, gitPath: chosen.git })).toBe(chosen.git);
  });

  it("ignores an empty TULIS_GIT", () => {
    const { dir, git } = makeDirWithGit();
    const env = { PATH: dir, TULIS_GIT: "" };
    expect(resolveGitPath({ env })).toBe(git);
  });

  it("rejects a relative TULIS_GIT", () => {
    const { git } = makeDirWithGit(makeDirUnderCwd());
    const env = { TULIS_GIT: relative(process.cwd(), git), PATH: "" };
    expect(isAbsolute(env.TULIS_GIT)).toBe(false);
    const error = catchError(() => resolveGitPath({ env }));
    expect(error.problem).toBe("bad-path");
    expect(error.name).toBe("GitSetupError");
    expect(error.message).toContain("TULIS_GIT");
  });

  it("rejects a missing file and does not fall back to PATH", () => {
    const onPath = makeDirWithGit();
    const missing = join(makeDir(), gitName);
    const env = { TULIS_GIT: missing, PATH: onPath.dir };
    const error = catchError(() => resolveGitPath({ env }));
    expect(error.problem).toBe("bad-path");
    expect(error.message).toBe(
      `TULIS_GIT is set to "${missing}", which is not the full path of a git program.`,
    );
  });

  it("rejects a folder", () => {
    const env = { TULIS_GIT: makeDir() };
    const error = catchError(() => resolveGitPath({ env }));
    expect(error.problem).toBe("bad-path");
  });

  it("names the git path when gitPath is bad", () => {
    const missing = join(makeDir(), gitName);
    const error = catchError(() =>
      resolveGitPath({ gitPath: missing, env: {} }),
    );
    expect(error.problem).toBe("bad-path");
    expect(error.message).toBe(
      `The git path is set to "${missing}", which is not the full path of a git program.`,
    );
  });

  it("shows control characters as ? in the message", () => {
    const env = { TULIS_GIT: "bad\u001b[31mpath" };
    const error = catchError(() => resolveGitPath({ env }));
    expect(error.message).toContain("bad?[31mpath");
    expect(error.message).not.toContain("\u001b");
  });

  it("reports not-found with an empty PATH", () => {
    const error = catchError(() => resolveGitPath({ env: { PATH: "" } }));
    expect(error.problem).toBe("not-found");
    expect(error.message).toBe(NOT_FOUND_MESSAGE);
  });

  it("reports not-found with no PATH key", () => {
    const error = catchError(() => resolveGitPath({ env: {} }));
    expect(error.problem).toBe("not-found");
    expect(error.message).toBe(NOT_FOUND_MESSAGE);
  });
});

describe("findGit", () => {
  it.skipIf(isWindows)(
    "reports too-old (a fake git needs a shell script, not possible on Windows)",
    async () => {
      const script = makeScript('echo "git version 2.24.9"');
      const error = await catchAsyncError(() =>
        findGit({ env: { TULIS_GIT: script } }),
      );
      expect(error).toBeInstanceOf(GitSetupError);
      expect((error as GitSetupError).problem).toBe("too-old");
      expect((error as GitSetupError).message).toBe(
        `Tulis needs Git 2.25 or later, but the git program at "${script}" is version 2.24.9. Update Git, or set TULIS_GIT to a newer git program.`,
      );
    },
  );

  it.skipIf(isWindows)(
    "reports unreadable-version for nonsense output",
    async () => {
      const script = makeScript('echo "nonsense"');
      const error = await catchAsyncError(() =>
        findGit({ env: { TULIS_GIT: script } }),
      );
      expect(error).toBeInstanceOf(GitSetupError);
      expect((error as GitSetupError).problem).toBe("unreadable-version");
      expect((error as GitSetupError).message).toBe(
        `Could not read the version of the git program at "${script}".`,
      );
    },
  );

  it.skipIf(isWindows)(
    "reports unreadable-version when the program fails",
    async () => {
      const script = makeScript("exit 1");
      const error = await catchAsyncError(() =>
        findGit({ env: { TULIS_GIT: script } }),
      );
      expect(error).toBeInstanceOf(GitSetupError);
      expect((error as GitSetupError).problem).toBe("unreadable-version");
      expect((error as GitSetupError).cause).toBeDefined();
    },
  );

  it.skipIf(isWindows)("accepts git version 2.25.0", async () => {
    const script = makeScript('echo "git version 2.25.0"');
    const result = await findGit({ env: { TULIS_GIT: script } });
    expect(result).toEqual({
      path: script,
      version: { major: 2, minor: 25, patch: 0 },
    });
  });

  it("finds the real git", async () => {
    const result = await findGit();
    expect(isAbsolute(result.path)).toBe(true);
    expect(isSupportedGitVersion(result.version)).toBe(true);
  });
});
