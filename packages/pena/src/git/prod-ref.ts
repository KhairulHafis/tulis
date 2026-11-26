import { GitCommandError, type GitRunner } from "./git-runner.js";
import { checkBranchName, isObjectId } from "./ref-name.js";
import { toSafeText } from "./safe-text.js";

export const PROD_REMOTE = "origin";

export type ProdRefSource = "remote" | "local";

export interface ProdRef {
  /** The branch name asked for, for example "main". */
  readonly branch: string;
  /** The full ref used, for example "refs/remotes/origin/main". */
  readonly ref: string;
  /** Full commit ID the ref points at. */
  readonly commit: string;
  /** "remote" for refs/remotes/origin/<branch>, "local" for refs/heads/<branch>. */
  readonly source: ProdRefSource;
}

export class NoProdRefError extends Error {
  readonly branch: string;
  /** Full ref names tried, in order. */
  readonly triedRefs: readonly string[];

  constructor(branch: string, triedRefs: readonly string[]) {
    const names = triedRefs.map((ref) => toSafeText(ref));
    super(
      `No prod branch found for "${toSafeText(branch)}". Tried ${names.join(" and ")}.`,
    );
    this.name = "NoProdRefError";
    this.branch = branch;
    this.triedRefs = triedRefs;
  }
}

/** The full ref names tried for `branch`, in order. Throws Error on an invalid branch name. */
export function prodRefCandidates(branch: string): string[] {
  checkBranchName(branch);
  return [`refs/remotes/${PROD_REMOTE}/${branch}`, `refs/heads/${branch}`];
}

/** Resolves the prod ref. Rejects with Error on an invalid branch name (before running git), NoProdRefError when neither ref exists, and GitCommandError for any other git failure. */
export async function resolveProdRef(
  runner: GitRunner,
  branch: string,
): Promise<ProdRef> {
  const candidates = prodRefCandidates(branch);
  for (const ref of candidates) {
    let output: string;
    try {
      output = await runner.run("rev-parse", [
        "-q",
        "--verify",
        `${ref}^{commit}`,
      ]);
    } catch (error) {
      if (
        error instanceof GitCommandError &&
        error.failure === "exit" &&
        error.exitCode === 1
      ) {
        continue;
      }
      throw error;
    }
    const lines = output.split(/\r?\n/).filter((line) => line !== "");
    const commit = lines[0];
    if (lines.length !== 1 || commit === undefined || !isObjectId(commit)) {
      throw new Error("git rev-parse did not return a single commit ID");
    }
    return {
      branch,
      ref,
      commit,
      source: ref.startsWith("refs/remotes/") ? "remote" : "local",
    };
  }
  throw new NoProdRefError(branch, candidates);
}
