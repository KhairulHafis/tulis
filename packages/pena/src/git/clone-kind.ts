import {
  GIT_CONFIG_QUERIES,
  GitCommandError,
  isNotFoundExit,
} from "./git-runner.js";
import type { GitConfigQuery, GitRunner } from "./git-runner.js";

export interface CloneKind {
  /** History is cut off (a shallow clone). */
  readonly shallow: boolean;
  /** Some file contents are not downloaded (a partial clone). */
  readonly partial: boolean;
}

/** True or false from `git rev-parse --is-shallow-repository`. Throws Error on any other output. */
export async function isShallowRepository(runner: GitRunner): Promise<boolean> {
  const output = await runner.run("rev-parse", ["--is-shallow-repository"]);
  if (output === "true\n") {
    return true;
  }
  if (output === "false\n") {
    return false;
  }
  throw new Error("Unexpected git rev-parse output");
}

/**
 * True if any record's value is "true". Records are "<key>\n<value>\0".
 * Throws Error on a record without a newline or with another value.
 */
export function parsePromisorRemotes(output: string): boolean {
  let found = false;
  for (const record of output.split("\0")) {
    if (record === "") {
      continue;
    }
    // Remote names may hold odd characters, so the value is what follows the
    // last newline.
    const newline = record.lastIndexOf("\n");
    if (newline === -1) {
      throw new Error("Unexpected git config output");
    }
    const value = record.slice(newline + 1);
    if (value === "true") {
      found = true;
    } else if (value !== "false") {
      throw new Error("Unexpected git config output");
    }
  }
  return found;
}

type LookupResult =
  | { readonly kind: "found"; readonly output: string }
  | { readonly kind: "not-set" }
  | { readonly kind: "unreadable" };

/**
 * Runs one fixed config lookup. Exit code 1 means the key is not set. Any
 * other exit code means git couldn't read the config (for example a bad
 * boolean value): Tulis can't tell, so the caller stays on the safe side and
 * treats the repo as partial (skips work that could download files).
 * Timeouts, spawn failures and other errors are rethrown.
 */
async function lookup(
  runner: GitRunner,
  query: GitConfigQuery,
): Promise<LookupResult> {
  try {
    const output = await runner.run("config", [...GIT_CONFIG_QUERIES[query]]);
    return { kind: "found", output };
  } catch (error) {
    if (isNotFoundExit(error)) {
      return { kind: "not-set" };
    }
    if (error instanceof GitCommandError && error.failure === "exit") {
      return { kind: "unreadable" };
    }
    throw error;
  }
}

/** True if the repo is a partial clone, or if git's config can't be read (safe side). */
export async function isPartialClone(runner: GitRunner): Promise<boolean> {
  const extension = await lookup(runner, "partialCloneExtension");
  if (extension.kind === "unreadable") {
    return true;
  }
  // The output is the value followed by NUL; an empty value doesn't count.
  if (
    extension.kind === "found" &&
    extension.output.replace(/\0+$/, "") !== ""
  ) {
    return true;
  }
  const promisor = await lookup(runner, "promisorRemotes");
  switch (promisor.kind) {
    case "unreadable":
      return true;
    case "not-set":
      return false;
    case "found":
      return parsePromisorRemotes(promisor.output);
  }
}

/** Whether the repo is a shallow clone and whether it is a partial clone. */
export async function detectCloneKind(runner: GitRunner): Promise<CloneKind> {
  const shallow = await isShallowRepository(runner);
  const partial = await isPartialClone(runner);
  return { shallow, partial };
}
