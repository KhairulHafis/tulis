import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { runGit, type GitSandbox } from "./run-git.js";

export interface CreateTestRepoOptions {
  /** Branch HEAD points at in the new repo. Default "main". */
  readonly branch?: string;
  /** Repo-local git settings written with `git config` right after init, for example { "core.autocrlf": "true" }. */
  readonly config?: Readonly<Record<string, string>>;
}

export interface CommitOptions {
  readonly message: string;
  /** Files to write before committing: repo-relative POSIX path -> content. */
  readonly files?: Readonly<Record<string, string | Uint8Array>>;
  /** Repo-relative POSIX paths to delete before committing. */
  readonly remove?: readonly string[];
  /** Author and committer date. Default: one day after the HEAD commit, or 2026-01-01 when there is none. */
  readonly date?: Date;
}

export interface TestRepo {
  /** Absolute real path of the working tree. */
  readonly dir: string;
  /** Runs git in `dir` with the sandbox. */
  git(args: readonly string[]): Promise<string>;
  /** Writes a file (creating folders). Path is repo-relative POSIX. */
  writeFile(path: string, content: string | Uint8Array): void;
  /** Reads a working-tree file as raw bytes. */
  readFile(path: string): Buffer;
  /** Writes `files`, deletes `remove`, stages everything, commits. Resolves with the full commit SHA. */
  commit(options: CommitOptions): Promise<string>;
  /** Creates a branch at `startPoint` (default HEAD) without switching to it. */
  createBranch(name: string, startPoint?: string): Promise<void>;
  /** Switches the working tree to an existing branch. */
  checkout(name: string): Promise<void>;
  /** Deletes the whole temp folder. Safe to call twice. */
  cleanup(): void;
}

const FIRST_COMMIT_MS = Date.UTC(2026, 0, 1);
const DAY_MS = 24 * 60 * 60 * 1000;

export function shorten(text: string): string {
  return text.length > 100 ? text.slice(0, 100) : text;
}

/** Turns a repo-relative POSIX path into an absolute path inside `dir`. */
function resolveInside(dir: string, path: string): string {
  const reject = (reason: string): Error =>
    new Error(`Invalid path "${shorten(path)}": ${reason}`);
  if (path === "") {
    throw reject("empty");
  }
  if (path.includes("\0")) {
    throw reject("contains NUL");
  }
  if (path.includes("\\")) {
    throw reject("contains a backslash");
  }
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path) || isAbsolute(path)) {
    throw reject("absolute");
  }
  const segments = path.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      throw reject("bad segment");
    }
  }
  const full = join(dir, ...segments);
  const rel = relative(dir, full);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw reject("outside the repo");
  }
  return full;
}

/** Throws unless every key and value is safe to hand to `git config` or `git clone -c`. */
export function checkConfig(config: Readonly<Record<string, string>>): void {
  for (const [key, value] of Object.entries(config)) {
    const badKey =
      key.length > 100 ||
      !/^[A-Za-z0-9.-]+$/.test(key) ||
      !key.includes(".") ||
      key.startsWith("-") ||
      key.startsWith(".");
    if (badKey) {
      throw new Error(`Invalid git config key "${shorten(key)}"`);
    }
    if (value.length > 1000 || /[\n\r\0]/.test(value)) {
      throw new Error(`Invalid git config value for key "${shorten(key)}"`);
    }
  }
}

export function checkRefName(name: string): void {
  if (name === "" || name.startsWith("-")) {
    throw new Error(`Invalid ref name "${shorten(name)}"`);
  }
}

/** Wraps an existing repo folder. `root` is the temp folder cleanup deletes. */
export function openTestRepo(
  root: string,
  dir: string,
  sandbox: GitSandbox,
): TestRepo {
  const git = (args: readonly string[], date?: Date): Promise<string> =>
    runGit(args, dir, sandbox, date);

  const nextScriptedDate = async (): Promise<Date> => {
    let head = "";
    try {
      head = (await git(["rev-parse", "-q", "--verify", "HEAD"])).trim();
    } catch {
      // No commit yet.
    }
    if (head === "") {
      return new Date(FIRST_COMMIT_MS);
    }
    const seconds = Number((await git(["log", "-1", "--format=%ct"])).trim());
    return new Date(seconds * 1000 + DAY_MS);
  };

  const writeFile = (path: string, content: string | Uint8Array): void => {
    const full = resolveInside(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  };

  return {
    dir,
    git: (args) => git(args),
    writeFile,
    readFile: (path) => readFileSync(resolveInside(dir, path)),
    async commit(options) {
      // Validate every path before touching the disk.
      for (const path of options.remove ?? []) {
        resolveInside(dir, path);
      }
      for (const path of Object.keys(options.files ?? {})) {
        resolveInside(dir, path);
      }
      const date = options.date ?? (await nextScriptedDate());
      for (const path of options.remove ?? []) {
        rmSync(resolveInside(dir, path), { force: true });
      }
      for (const [path, content] of Object.entries(options.files ?? {})) {
        writeFile(path, content);
      }
      await git(["add", "-A", "--", "."], date);
      await git(["commit", "-q", "--allow-empty", "-m", options.message], date);
      return (await git(["rev-parse", "HEAD"])).trim();
    },
    async createBranch(name, startPoint) {
      checkRefName(name);
      if (startPoint !== undefined) {
        checkRefName(startPoint);
      }
      await git(
        startPoint === undefined
          ? ["branch", name]
          : ["branch", name, startPoint],
      );
    },
    async checkout(name) {
      checkRefName(name);
      await git(["checkout", "-q", name, "--"]);
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** Makes a temp folder with an empty home folder for git config. */
export function makeTempRoot(): {
  readonly root: string;
  readonly sandbox: GitSandbox;
} {
  // The native version also expands Windows short names (RUNNER~1), as git does.
  const root = realpathSync.native(
    mkdtempSync(join(tmpdir(), "tulis-testkit-")),
  );
  const homeDir = join(root, "home");
  try {
    mkdirSync(homeDir);
    writeFileSync(join(homeDir, ".gitconfig"), "");
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
  return { root, sandbox: { homeDir, ceilingDir: root } };
}

/** Creates a throwaway git repo in a temp folder. */
export async function createTestRepo(
  options: CreateTestRepoOptions = {},
): Promise<TestRepo> {
  const branch = options.branch ?? "main";
  checkRefName(branch);
  const config = options.config ?? {};
  checkConfig(config);
  const { root, sandbox } = makeTempRoot();
  const dir = join(root, "repo");
  try {
    mkdirSync(dir);
    await runGit(["init", "-q"], dir, sandbox);
    await runGit(
      ["symbolic-ref", "HEAD", `refs/heads/${branch}`],
      dir,
      sandbox,
    );
    for (const [key, value] of Object.entries(config)) {
      await runGit(["config", key, value], dir, sandbox);
    }
    return openTestRepo(root, dir, sandbox);
  } catch (error) {
    if (existsSync(root)) {
      rmSync(root, { recursive: true, force: true });
    }
    throw error;
  }
}
