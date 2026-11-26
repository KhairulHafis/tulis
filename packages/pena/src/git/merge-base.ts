import { isNotFoundExit, type GitRunner } from "./git-runner.js";
import { checkObjectId, parseSingleCommitId } from "./ref-name.js";

export type MergeBaseResult =
  | { readonly kind: "found"; readonly commit: string }
  | { readonly kind: "none" };

/** The commit HEAD points at, or undefined when HEAD has no commit yet. Rejects with GitCommandError for any other git failure. */
export async function resolveHead(
  runner: GitRunner,
): Promise<string | undefined> {
  let output: string;
  try {
    output = await runner.run("rev-parse", ["-q", "--verify", "HEAD^{commit}"]);
  } catch (error) {
    if (isNotFoundExit(error)) {
      return undefined;
    }
    throw error;
  }
  return parseSingleCommitId(output, "rev-parse");
}

/** Finds where the histories of two commits meet. "none" is a normal result (unrelated or cut-off history). Rejects with Error (before git runs) unless both are full object IDs, and with GitCommandError for any git failure other than exit code 1. */
export async function findMergeBase(
  runner: GitRunner,
  commitA: string,
  commitB: string,
): Promise<MergeBaseResult> {
  checkObjectId(commitA);
  checkObjectId(commitB);
  let output: string;
  try {
    output = await runner.run("merge-base", [commitA, commitB]);
  } catch (error) {
    if (isNotFoundExit(error)) {
      return { kind: "none" };
    }
    throw error;
  }
  return { kind: "found", commit: parseSingleCommitId(output, "merge-base") };
}
