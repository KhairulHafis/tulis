import { execFile } from "node:child_process";
import { lstatSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { Corpus } from "./corpus-list.ts";

/**
 * Runs one git command and resolves with its stdout. Rejects with an Error
 * naming the git subcommand and the folder, plus git's stderr (trimmed).
 */
export type GitRunner = (
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
) => Promise<string>;

export interface GitRunnerOptions {
  /** URL schemes git may use. Default ["https"]. Tests pass ["file"]. */
  readonly allowedProtocols?: readonly string[];
}

export type FetchOutcome = "fetched" | "up-to-date";

const LONG_TIMEOUT_MS = 20 * 60 * 1000;
const SHORT_TIMEOUT_MS = 60 * 1000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const PROTOCOL_PATTERN = /^[a-z][a-z0-9+.-]*$/;

/**
 * The full argument list passed to the git executable: hardening flags first,
 * then the caller's args.
 */
export function buildGitArgs(
  args: readonly string[],
  allowedProtocols: readonly string[],
): string[] {
  const protocolFlags: string[] = [];
  for (const protocol of allowedProtocols) {
    if (!PROTOCOL_PATTERN.test(protocol)) {
      throw new Error(`Invalid git protocol name "${protocol.slice(0, 32)}"`);
    }
    protocolFlags.push("-c", `protocol.${protocol}.allow=always`);
  }
  return [
    "--no-pager",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.symlinks=false",
    "-c",
    "protocol.allow=never",
    ...protocolFlags,
    ...args,
  ];
}

/**
 * The environment for git: a copy of `env` without any GIT_ variable, plus
 * GIT_TERMINAL_PROMPT=0 and GIT_LFS_SKIP_SMUDGE=1.
 */
export function buildGitEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (!key.toUpperCase().startsWith("GIT_")) {
      result[key] = value;
    }
  }
  result["GIT_TERMINAL_PROMPT"] = "0";
  result["GIT_LFS_SKIP_SMUDGE"] = "1";
  return result;
}

export function createGitRunner(options: GitRunnerOptions = {}): GitRunner {
  const allowedProtocols = options.allowedProtocols ?? ["https"];
  return (args, cwd, timeoutMs) => {
    const gitArgs = buildGitArgs(args, allowedProtocols);
    const subcommand = args[0] ?? "(none)";
    return new Promise<string>((resolve, reject) => {
      execFile(
        "git",
        gitArgs,
        {
          cwd,
          timeout: timeoutMs,
          env: buildGitEnv(process.env),
          maxBuffer: MAX_OUTPUT_BYTES,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          if (error === null) {
            resolve(stdout);
            return;
          }
          const timedOut = error.killed === true;
          const reason = timedOut
            ? `timed out after ${String(Math.round(timeoutMs / 1000))} seconds`
            : "failed";
          const detail = stderr.trim();
          reject(
            new Error(
              `git ${subcommand} ${reason} in ${cwd}${detail === "" ? "" : `: ${detail}`}`,
              { cause: error },
            ),
          );
        },
      );
    });
  };
}

function checkRepoDir(repoDir: string): "missing" | "repository" {
  const info = lstatSync(repoDir, { throwIfNoEntry: false });
  if (info === undefined) {
    return "missing";
  }
  if (info.isSymbolicLink()) {
    throw new Error(`${repoDir} is a symbolic link. Delete it and run again.`);
  }
  if (!info.isDirectory()) {
    throw new Error(`${repoDir} exists but is not a directory.`);
  }
  const gitInfo = lstatSync(join(repoDir, ".git"), { throwIfNoEntry: false });
  if (gitInfo === undefined || !gitInfo.isDirectory()) {
    throw new Error(
      `${repoDir} exists but is not a git repository. Delete it and run again.`,
    );
  }
  return "repository";
}

async function isUpToDate(
  corpus: Corpus,
  repoDir: string,
  git: GitRunner,
): Promise<boolean> {
  try {
    const head = await git(
      ["rev-parse", "--verify", "--quiet", "HEAD"],
      repoDir,
      SHORT_TIMEOUT_MS,
    );
    if (head.trim() !== corpus.commit) {
      return false;
    }
    const sparse = await git(
      ["sparse-checkout", "list"],
      repoDir,
      SHORT_TIMEOUT_MS,
    );
    return sparse.trim() === corpus.docsPath;
  } catch {
    // No commit yet, or no sparse checkout set up: an unfinished earlier run.
    return false;
  }
}

async function downloadDocs(
  corpus: Corpus,
  repoDir: string,
  git: GitRunner,
): Promise<void> {
  await git(
    [
      "fetch",
      "--quiet",
      "--depth=1",
      "--filter=blob:none",
      "--no-tags",
      "origin",
      corpus.commit,
    ],
    repoDir,
    LONG_TIMEOUT_MS,
  );
  await git(
    ["sparse-checkout", "set", "--", corpus.docsPath],
    repoDir,
    SHORT_TIMEOUT_MS,
  );
  await git(
    ["checkout", "--quiet", "--force", "-B", corpus.branch, corpus.commit],
    repoDir,
    LONG_TIMEOUT_MS,
  );
  await git(
    ["update-ref", `refs/remotes/origin/${corpus.branch}`, corpus.commit],
    repoDir,
    SHORT_TIMEOUT_MS,
  );
  const head = await git(["rev-parse", "HEAD"], repoDir, SHORT_TIMEOUT_MS);
  if (head.trim() !== corpus.commit) {
    throw new Error(
      `${corpus.name}: HEAD is ${head.trim().slice(0, 7)} after checkout, expected ${corpus.commit.slice(0, 7)}`,
    );
  }
}

/**
 * Brings one corpus to its pinned commit and docs path. `onDownloadStart` is
 * called only when a download is about to begin, so callers can say so.
 */
export async function fetchCorpus(
  corpus: Corpus,
  cacheDir: string,
  git: GitRunner,
  onDownloadStart: () => void = () => undefined,
): Promise<FetchOutcome> {
  const repoDir = join(cacheDir, corpus.name);
  if (relative(cacheDir, repoDir) !== corpus.name) {
    throw new Error(`${corpus.name}: corpus folder must be inside the cache`);
  }

  if (checkRepoDir(repoDir) === "missing") {
    mkdirSync(repoDir);
    await git(["init", "--quiet"], repoDir, SHORT_TIMEOUT_MS);
    await git(
      ["remote", "add", "origin", corpus.url],
      repoDir,
      SHORT_TIMEOUT_MS,
    );
  } else {
    if (await isUpToDate(corpus, repoDir, git)) {
      return "up-to-date";
    }
    const remotes = await git(["remote"], repoDir, SHORT_TIMEOUT_MS);
    const hasOrigin = remotes.split(/\r?\n/).some((r) => r.trim() === "origin");
    await git(
      ["remote", hasOrigin ? "set-url" : "add", "origin", corpus.url],
      repoDir,
      SHORT_TIMEOUT_MS,
    );
  }
  onDownloadStart();
  await downloadDocs(corpus, repoDir, git);
  return "fetched";
}

/**
 * Fetches each corpus in order. Logs a line when a download starts, and one
 * result line per corpus.
 */
export async function fetchAllCorpora(
  corpora: readonly Corpus[],
  cacheDir: string,
  git: GitRunner,
  log: (line: string) => void,
): Promise<void> {
  for (const corpus of corpora) {
    const short = corpus.commit.slice(0, 7);
    const outcome = await fetchCorpus(corpus, cacheDir, git, () => {
      log(`${corpus.name}: fetching ${short}, docs only (${corpus.docsPath})`);
    });
    log(
      outcome === "fetched"
        ? `${corpus.name}: fetched ${short}`
        : `${corpus.name}: already at ${short}`,
    );
  }
}
