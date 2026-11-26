import { execFile } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { buildGitEnv } from "./git-env.js";
import { toSafeText } from "./safe-text.js";

const execFileAsync = promisify(execFile);

export interface GitVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number; // 0 when the output has no patch number
}

export interface GitExecutable {
  /** Absolute path of the git program. */
  readonly path: string;
  readonly version: GitVersion;
}

export type GitSetupProblem =
  "not-found" | "bad-path" | "too-old" | "unreadable-version";

export class GitSetupError extends Error {
  readonly problem: GitSetupProblem;

  constructor(
    problem: GitSetupProblem,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "GitSetupError";
    this.problem = problem;
  }
}

export const MIN_GIT_VERSION: GitVersion = { major: 2, minor: 25, patch: 0 };

export interface FindGitOptions {
  /** Absolute git path chosen by the caller (for example VS Code's). Wins over TULIS_GIT and PATH. */
  readonly gitPath?: string;
  /** Environment to read TULIS_GIT and PATH from. Default process.env. */
  readonly env?: NodeJS.ProcessEnv;
}

const MAX_VERSION_LINE_LENGTH = 200;
const VERSION_PATTERN = /^git version (\d{1,5})\.(\d{1,5})(?:\.(\d{1,5}))?/;

/** Parses the first line of `git --version` output. undefined when it is not recognised. */
export function parseGitVersion(output: string): GitVersion | undefined {
  const firstLine = output.split(/\r?\n/)[0] ?? "";
  if (firstLine.length > MAX_VERSION_LINE_LENGTH) {
    return undefined;
  }
  const match = VERSION_PATTERN.exec(firstLine);
  if (match === null) {
    return undefined;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: match[3] === undefined ? 0 : Number(match[3]),
  };
}

/** True when `version` is MIN_GIT_VERSION or newer. */
export function isSupportedGitVersion(version: GitVersion): boolean {
  if (version.major !== MIN_GIT_VERSION.major) {
    return version.major > MIN_GIT_VERSION.major;
  }
  if (version.minor !== MIN_GIT_VERSION.minor) {
    return version.minor > MIN_GIT_VERSION.minor;
  }
  return version.patch >= MIN_GIT_VERSION.patch;
}

function isRegularFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function isExecutable(candidate: string): boolean {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function readPathVariable(env: NodeJS.ProcessEnv, isWindows: boolean): string {
  if (!isWindows) {
    return env["PATH"] ?? "";
  }
  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase() === "PATH" && value !== undefined) {
      return value;
    }
  }
  return "";
}

function stripQuotes(entry: string): string {
  if (entry.length >= 2 && entry.startsWith('"') && entry.endsWith('"')) {
    return entry.slice(1, -1);
  }
  return entry;
}

function checkExplicitPath(value: string, label: string): string {
  if (isAbsolute(value) && isRegularFile(value)) {
    return value;
  }
  throw new GitSetupError(
    "bad-path",
    `${label} is set to "${toSafeText(value)}", which is not the full path of a git program.`,
  );
}

/** Finds the git program without running it. Throws GitSetupError ("not-found" or "bad-path"). */
export function resolveGitPath(options?: FindGitOptions): string {
  const env = options?.env ?? process.env;

  if (options?.gitPath !== undefined) {
    return checkExplicitPath(options.gitPath, "The git path");
  }
  const tulisGit = env["TULIS_GIT"];
  if (tulisGit !== undefined && tulisGit !== "") {
    return checkExplicitPath(tulisGit, "TULIS_GIT");
  }

  const isWindows = process.platform === "win32";
  const fileName = isWindows ? "git.exe" : "git";
  for (const rawEntry of readPathVariable(env, isWindows).split(delimiter)) {
    const entry = isWindows ? stripQuotes(rawEntry) : rawEntry;
    if (entry === "" || !isAbsolute(entry)) {
      continue;
    }
    const candidate = join(entry, fileName);
    if (isRegularFile(candidate) && (isWindows || isExecutable(candidate))) {
      return candidate;
    }
  }

  throw new GitSetupError(
    "not-found",
    "Tulis needs Git 2.25 or later, but git was not found on PATH. Install Git, or set TULIS_GIT to the full path of the git program.",
  );
}

/** resolveGitPath, then runs `<path> --version` and checks the version. Throws GitSetupError. */
export async function findGit(
  options?: FindGitOptions,
): Promise<GitExecutable> {
  const env = options?.env ?? process.env;
  const path = resolveGitPath(options);
  const safePath = toSafeText(path, { maxLength: 300 });

  let stdout: string;
  try {
    const result = await execFileAsync(path, ["--version"], {
      env: buildGitEnv(env),
      cwd: tmpdir(),
      timeout: 10_000,
      killSignal: "SIGKILL",
      maxBuffer: 64 * 1024,
      windowsHide: true,
    });
    stdout = result.stdout;
  } catch (error) {
    throw new GitSetupError(
      "unreadable-version",
      `Could not read the version of the git program at "${safePath}".`,
      { cause: error },
    );
  }

  const version = parseGitVersion(stdout);
  if (version === undefined) {
    throw new GitSetupError(
      "unreadable-version",
      `Could not read the version of the git program at "${safePath}".`,
    );
  }
  if (!isSupportedGitVersion(version)) {
    throw new GitSetupError(
      "too-old",
      `Tulis needs Git 2.25 or later, but the git program at "${safePath}" is version ${String(version.major)}.${String(version.minor)}.${String(version.patch)}. Update Git, or set TULIS_GIT to a newer git program.`,
    );
  }
  return { path, version };
}
