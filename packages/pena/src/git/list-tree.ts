import type { GitRunner } from "./git-runner.js";
import { isObjectId } from "./ref-name.js";
import { toSafeText } from "./safe-text.js";

export interface TreeFile {
  /** Repo-relative path with "/" separators, exactly as stored in git. */
  readonly path: string;
  readonly blobId: string;
  readonly executable: boolean;
}

export type SkipReason = "symlink" | "submodule" | "unsafe-path";

export interface SkippedTreeEntry {
  readonly path: string;
  readonly reason: SkipReason;
}

export interface TreeListing {
  /** In git's order (sorted by path). */
  readonly files: readonly TreeFile[];
  readonly skipped: readonly SkippedTreeEntry[];
}

/** True when a repo-relative path is safe to use: not empty, no leading "/", no empty, "." or ".." segments, no segment equal to ".git" in any letter case, no backslash, no NUL. */
export function isSafeTreePath(path: string): boolean {
  if (path === "" || path.includes("\\") || path.includes("\0")) {
    return false;
  }
  for (const segment of path.split("/")) {
    if (
      segment === "" ||
      segment === "." ||
      segment === ".." ||
      segment.toLowerCase() === ".git"
    ) {
      return false;
    }
  }
  return true;
}

// <mode> SP <type> SP <object id> TAB <path>. Paths may hold newlines and tabs.
const RECORD = /^(\d{6}) (blob|commit) ([0-9a-f]{40}|[0-9a-f]{64})\t([\s\S]+)$/;

/** Parses `git ls-tree -r -z` output. Throws Error on a record that doesn't match the format (message without the raw record; at most a toSafeText-shortened path). */
export function parseLsTree(output: string): TreeListing {
  const files: TreeFile[] = [];
  const skipped: SkippedTreeEntry[] = [];
  const records = output.split("\0");
  // Only the single empty string after the final NUL is ignored.
  if (records[records.length - 1] === "") {
    records.pop();
  }
  for (const record of records) {
    const match = RECORD.exec(record);
    if (match === null) {
      throw new Error("Unexpected record in git ls-tree output");
    }
    const [, mode = "", type = "", blobId = "", path = ""] = match;
    if (!isSafeTreePath(path)) {
      skipped.push({ path, reason: "unsafe-path" });
    } else if (type === "commit" && mode === "160000") {
      skipped.push({ path, reason: "submodule" });
    } else if (type === "blob" && mode === "120000") {
      skipped.push({ path, reason: "symlink" });
    } else if (type === "blob" && (mode === "100644" || mode === "100755")) {
      files.push({ path, blobId, executable: mode === "100755" });
    } else {
      throw new Error(
        `Unexpected mode ${mode} and type ${type} for "${toSafeText(path)}" in git ls-tree output`,
      );
    }
  }
  return { files, skipped };
}

/** Lists the files in `commit`. Rejects with Error if `commit` is not a full object ID (before running git), and with GitCommandError if git fails. */
export async function listTree(
  runner: GitRunner,
  commit: string,
): Promise<TreeListing> {
  if (!isObjectId(commit)) {
    throw new Error(`Not a full object ID: "${toSafeText(commit)}"`);
  }
  // No -l: sizes would need blobs a partial clone doesn't have.
  const output = await runner.run("ls-tree", [
    "-r",
    "-z",
    "--full-tree",
    commit,
  ]);
  return parseLsTree(output);
}
