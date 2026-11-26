import { execFile, spawn } from "node:child_process";
import type { ChildProcess, ExecFileException } from "node:child_process";
import path, { isAbsolute } from "node:path";
import type { Readable, Writable } from "node:stream";
import type { GitExecutable } from "./find-git.js";
import { buildGitEnv } from "./git-env.js";
import { toSafeText } from "./safe-text.js";

export const GIT_COMMANDS = [
  "rev-parse",
  "ls-tree",
  "cat-file",
  "diff-tree",
  "log",
  "show",
  "merge-base",
  "config",
] as const;

export type GitCommand = (typeof GIT_COMMANDS)[number];

export function isGitCommand(value: string): value is GitCommand {
  return GIT_COMMANDS.some((command) => command === value);
}

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

export interface GitRunOptions {
  /** File paths, always placed after "--". */
  readonly paths?: readonly string[];
  /** Default DEFAULT_TIMEOUT_MS. Integer, 1 or more. */
  readonly timeoutMs?: number;
  /** Default DEFAULT_MAX_OUTPUT_BYTES. Integer, 1 or more. */
  readonly maxOutputBytes?: number;
}

/** The only two `git config` calls Pena may run. Both are read-only lookups. */
export const GIT_CONFIG_QUERIES = {
  partialCloneExtension: ["-z", "--get", "extensions.partialclone"],
  promisorRemotes: ["-z", "--bool", "--get-regexp", "^remote\\..*\\.promisor$"],
} as const;

export type GitConfigQuery = keyof typeof GIT_CONFIG_QUERIES;

function isFixedConfigQuery(args: readonly string[]): boolean {
  return Object.values<readonly string[]>(GIT_CONFIG_QUERIES).some(
    (query) =>
      query.length === args.length &&
      query.every((value, index) => value === args[index]),
  );
}

const DIFF_COMMANDS: readonly string[] = ["diff-tree", "log", "show"];

/** The full argument list given to the git program. Throws Error on a bad command, a locked-down config call, a "--" in args, or a NUL in any arg or path. */
export function buildGitArgs(
  command: GitCommand,
  args: readonly string[],
  paths?: readonly string[],
): string[] {
  if (!isGitCommand(command)) {
    throw new Error(`Unknown git command "${toSafeText(String(command))}"`);
  }
  if (args.includes("--")) {
    throw new Error('Pass file paths in "paths", not after "--" in args');
  }
  const filePaths = paths ?? [];
  if (
    command === "config" &&
    (filePaths.length > 0 || !isFixedConfigQuery(args))
  ) {
    throw new Error(
      "git config is allowed only for Tulis's fixed read-only lookups",
    );
  }
  if ([...args, ...filePaths].some((value) => value.includes("\0"))) {
    throw new Error("Git arguments must not contain NUL characters");
  }
  return [
    "--no-pager",
    "--no-replace-objects",
    "--literal-pathspecs",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "protocol.allow=never",
    command,
    ...(DIFF_COMMANDS.includes(command)
      ? ["--no-ext-diff", "--no-textconv"]
      : []),
    ...args,
    ...(filePaths.length > 0 ? ["--", ...filePaths] : []),
  ];
}

export type GitFailure = "exit" | "timeout" | "output-too-large" | "spawn";

export class GitCommandError extends Error {
  readonly command: GitCommand;
  readonly failure: GitFailure;
  /** git's exit code, when it exited. */
  readonly exitCode: number | undefined;
  /** git's stderr, through toSafeText({ maxLength: 2000, keepNewlines: true }). "" when none. */
  readonly stderr: string;

  constructor(
    command: GitCommand,
    failure: GitFailure,
    message: string,
    details: { exitCode?: number; stderr?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: details.cause });
    this.name = "GitCommandError";
    this.command = command;
    this.failure = failure;
    this.exitCode = details.exitCode;
    this.stderr = details.stderr ?? "";
  }
}

/** True when git exited with code 1, which rev-parse --verify, merge-base and config use to say "not found". */
export function isNotFoundExit(error: unknown): boolean {
  return (
    error instanceof GitCommandError &&
    error.failure === "exit" &&
    error.exitCode === 1
  );
}

export interface GitExit {
  /** git's exit code, or null when it was stopped by a signal or never started. */
  readonly exitCode: number | null;
  /** The signal that stopped git, or null. */
  readonly signal: NodeJS.Signals | null;
  /** git's stderr through toSafeText({ maxLength: 2000, keepNewlines: true }); "" when none. */
  readonly stderr: string;
  /** Set only when git could not be started: a GitCommandError with failure "spawn". */
  readonly startError?: GitCommandError;
}

export interface GitProcess {
  /** git's stdin. Write errors (for example EPIPE after git exits) are swallowed here; they show up in `exited`. */
  readonly stdin: Writable;
  /** git's stdout as raw bytes (Buffer chunks, no encoding set). */
  readonly stdout: Readable;
  /** Resolves once git has exited (or failed to start). Never rejects. */
  readonly exited: Promise<GitExit>;
  /** Stops git and everything it started (taskkill /T /F on Windows, SIGKILL elsewhere). Safe to call more than once, and after git has exited (then it does nothing). */
  stop(): void;
}

export interface GitStartOptions {
  /** File paths, always placed after "--". */
  readonly paths?: readonly string[];
}

const MAX_START_STDERR_BYTES = 64 * 1024;

export interface GitRunner {
  readonly git: GitExecutable;
  /** Absolute folder every command runs in. */
  readonly repoDir: string;
  /** Runs one read command and resolves with stdout as UTF-8 text. Rejects with GitCommandError. */
  run(
    command: GitCommand,
    args: readonly string[],
    options?: GitRunOptions,
  ): Promise<string>;
  /** Starts one read command with the same flags and environment as run(), and returns at once. No timeout of its own: the caller must call stop() when done or on its own timeout. Throws Error on bad input (same rules as buildGitArgs). */
  start(
    command: GitCommand,
    args: readonly string[],
    options?: GitStartOptions,
  ): GitProcess;
}

function checkLimit(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be an integer of 1 or more`);
  }
}

function toGitError(
  command: GitCommand,
  error: ExecFileException,
  rawStderr: string,
  timeoutMs: number,
  maxOutputBytes: number,
  timedOut: boolean,
): GitCommandError {
  const stderr = toSafeText(rawStderr, {
    maxLength: 2000,
    keepNewlines: true,
  });
  if (timedOut) {
    return new GitCommandError(
      command,
      "timeout",
      `git ${command} took longer than ${String(timeoutMs)} ms and was stopped.`,
      { stderr, cause: error },
    );
  }
  if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
    return new GitCommandError(
      command,
      "output-too-large",
      `git ${command} produced more than ${String(maxOutputBytes)} bytes of output and was stopped.`,
      { stderr, cause: error },
    );
  }
  if (typeof error.code === "number") {
    const firstLine = stderr.split(/\r?\n/)[0] ?? "";
    const suffix = firstLine === "" ? "" : `: ${firstLine}`;
    return new GitCommandError(
      command,
      "exit",
      `git ${command} failed with exit code ${String(error.code)}${suffix}`,
      { exitCode: error.code, stderr, cause: error },
    );
  }
  return new GitCommandError(
    command,
    "spawn",
    `Could not start git ${command}.`,
    { stderr, cause: error },
  );
}

export interface StopCommand {
  readonly file: string;
  readonly args: readonly string[];
}

/**
 * How to stop a running git process and everything it started. On Windows
 * git.exe is a launcher that starts the real git as a child, so the whole
 * tree must go (taskkill). Elsewhere: undefined, meaning child.kill("SIGKILL").
 */
export function buildStopCommand(
  pid: number,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): StopCommand | undefined {
  if (platform !== "win32") {
    return undefined;
  }
  const key = Object.keys(env).find(
    (name) => name.toLowerCase() === "systemroot",
  );
  const value = key === undefined ? undefined : env[key];
  const root =
    value !== undefined && value !== "" && path.win32.isAbsolute(value)
      ? value
      : "C:\\Windows";
  return {
    file: path.win32.join(root, "System32", "taskkill.exe"),
    args: ["/PID", String(pid), "/T", "/F"],
  };
}

const STOP_COMMAND_TIMEOUT_MS = 10_000;

/** Stops git and, on Windows, everything it started. Falls back to a plain kill. */
function stopGit(child: ChildProcess): void {
  const stop =
    child.pid === undefined
      ? undefined
      : buildStopCommand(child.pid, process.platform, process.env);
  if (stop === undefined) {
    child.kill("SIGKILL");
    return;
  }
  execFile(
    stop.file,
    [...stop.args],
    { windowsHide: true, timeout: STOP_COMMAND_TIMEOUT_MS },
    (error) => {
      if (error !== null) {
        child.kill("SIGKILL");
      }
    },
  );
}

/** Throws Error if repoDir is not absolute. `env` is the base environment (default process.env); buildGitEnv is applied to it on every run. */
export function createGitRunner(
  git: GitExecutable,
  repoDir: string,
  env: NodeJS.ProcessEnv = process.env,
): GitRunner {
  if (!isAbsolute(repoDir)) {
    throw new Error("The repo folder must be an absolute path");
  }
  return {
    git,
    repoDir,
    // async, so bad input rejects the promise instead of throwing.
    async run(command, args, options) {
      const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const maxOutputBytes =
        options?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
      checkLimit("timeoutMs", timeoutMs);
      checkLimit("maxOutputBytes", maxOutputBytes);
      const gitArgs = buildGitArgs(command, args, options?.paths);

      return await new Promise<string>((resolve, reject) => {
        // The runner keeps its own timer instead of execFile's "timeout": on
        // Windows git.exe is a launcher, and Node would stop only the launcher.
        let timedOut = false;
        const child = execFile(
          git.path,
          gitArgs,
          {
            cwd: repoDir,
            env: buildGitEnv(env),
            killSignal: "SIGKILL",
            maxBuffer: maxOutputBytes,
            encoding: "utf8",
            windowsHide: true,
          },
          (error, stdout, stderr) => {
            clearTimeout(timer);
            if (error === null) {
              resolve(stdout);
              return;
            }
            reject(
              toGitError(
                command,
                error,
                stderr,
                timeoutMs,
                maxOutputBytes,
                timedOut,
              ),
            );
          },
        );
        const timer = setTimeout(() => {
          timedOut = true;
          stopGit(child);
        }, timeoutMs);
      });
    },
    start(command, args, options) {
      const gitArgs = buildGitArgs(command, args, options?.paths);
      const child = spawn(git.path, gitArgs, {
        cwd: repoDir,
        env: buildGitEnv(env),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      // A write after git exits fails with EPIPE; that must not crash Node.
      child.stdin.on("error", () => {
        // Swallowed on purpose. The outcome shows up in `exited`.
      });

      const stderrChunks: Buffer[] = [];
      let stderrBytes = 0;
      child.stderr.on("data", (chunk: Buffer) => {
        const room = MAX_START_STDERR_BYTES - stderrBytes;
        if (room > 0) {
          const kept = chunk.subarray(0, room);
          stderrChunks.push(kept);
          stderrBytes += kept.length;
        }
      });

      let finished = false;
      const exited = new Promise<GitExit>((resolve) => {
        child.on("error", (error) => {
          if (finished) {
            return;
          }
          finished = true;
          resolve({
            exitCode: null,
            signal: null,
            stderr: "",
            startError: new GitCommandError(
              command,
              "spawn",
              `Could not start git ${command}.`,
              { cause: error },
            ),
          });
        });
        // "close" comes after stdio has ended, so stderr is complete.
        child.on("close", (exitCode, signal) => {
          if (finished) {
            return;
          }
          finished = true;
          resolve({
            exitCode,
            signal,
            stderr: toSafeText(Buffer.concat(stderrChunks).toString("utf8"), {
              maxLength: 2000,
              keepNewlines: true,
            }),
          });
        });
      });

      return {
        stdin: child.stdin,
        stdout: child.stdout,
        exited,
        stop() {
          // Once git has exited its process ID may be reused, so never
          // signal it again (exitCode/signalCode are set on "exit").
          const ended = child.exitCode !== null || child.signalCode !== null;
          if (!finished && !ended) {
            stopGit(child);
          }
        },
      };
    },
  };
}
