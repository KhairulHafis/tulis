import type { GitRunner } from "./git-runner.js";
import { checkObjectId } from "./ref-name.js";
import { toSafeText } from "./safe-text.js";
import { TREE_ENTRY_OBJECT_TYPE, classifyTreeMode } from "./tree-entry.js";

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

export interface LsTreeRecord {
  readonly mode: string;
  readonly type: "blob" | "tree" | "commit";
  readonly objectId: string;
  readonly path: string;
}

// <mode> SP <type> SP <object id> TAB <path>. Paths may hold newlines and tabs.
const RECORD =
  /^(\d{6}) (blob|tree|commit) ([0-9a-f]{40}|[0-9a-f]{64})\t([\s\S]+)$/;

function isObjectType(value: string): value is LsTreeRecord["type"] {
  return value === "blob" || value === "tree" || value === "commit";
}

/** Splits `git ls-tree -z` output into records, in git's order. Throws Error on a record that doesn't match the format (message without the raw record). */
export function parseLsTreeRecords(output: string): LsTreeRecord[] {
  const records = output.split("\0");
  // Only the single empty string after the final NUL is ignored.
  if (records[records.length - 1] === "") {
    records.pop();
  }
  return records.map((record) => {
    const match = RECORD.exec(record);
    const [, mode = "", type = "", objectId = "", path = ""] = match ?? [];
    if (match === null || !isObjectType(type)) {
      throw new Error("Unexpected record in git ls-tree output");
    }
    return { mode, type, objectId, path };
  });
}

/** Parses `git ls-tree -r -z` output. Throws Error on a record that doesn't match the format, or a folder or unknown entry (message without the raw record; at most a toSafeText-shortened path). */
export function parseLsTree(output: string): TreeListing {
  const files: TreeFile[] = [];
  const skipped: SkippedTreeEntry[] = [];
  for (const record of parseLsTreeRecords(output)) {
    const { mode, type, objectId: blobId, path } = record;
    const kind = classifyTreeMode(mode);
    const typeMatches =
      kind !== undefined && TREE_ENTRY_OBJECT_TYPE[kind] === type;
    if (!isSafeTreePath(path)) {
      skipped.push({ path, reason: "unsafe-path" });
    } else if (typeMatches && kind === "submodule") {
      skipped.push({ path, reason: "submodule" });
    } else if (typeMatches && kind === "symlink") {
      skipped.push({ path, reason: "symlink" });
    } else if (typeMatches && (kind === "file" || kind === "executable")) {
      files.push({ path, blobId, executable: kind === "executable" });
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
  checkObjectId(commit);
  // No -l: sizes would need blobs a partial clone doesn't have.
  const output = await runner.run("ls-tree", [
    "-r",
    "-z",
    "--full-tree",
    commit,
  ]);
  return parseLsTree(output);
}
