import type { GitRunner } from "./git-runner.js";
import {
  isSafeTreePath,
  type SkippedTreeEntry,
  type SkipReason,
} from "./list-tree.js";
import { checkObjectId } from "./ref-name.js";
import { classifyTreeMode, type TreeEntryKind } from "./tree-entry.js";

export type TreeChangeKind = "added" | "modified" | "deleted";

export interface TreeChange {
  /** Repo-relative path with "/" separators, exactly as stored in git. */
  readonly path: string;
  readonly kind: TreeChangeKind;
  /** Set for "modified" and "deleted". */
  readonly oldBlobId?: string;
  /** Set for "added" and "modified". */
  readonly newBlobId?: string;
}

export interface TreeDiff {
  /** Regular files only, in git's order. */
  readonly changes: readonly TreeChange[];
  readonly skipped: readonly SkippedTreeEntry[];
}

const ZERO_MODE = "000000";

// :<old mode> SP <new mode> SP <old id> SP <new id> SP <status>
const HEADER =
  /^:(\d{6}) (\d{6}) ([0-9a-f]{40}|[0-9a-f]{64}) ([0-9a-f]{40}|[0-9a-f]{64}) ([ADMT])$/;

const BAD_RECORD = "Unexpected record in git diff-tree output";

function isRegularFile(kind: TreeEntryKind | undefined): boolean {
  return kind === "file" || kind === "executable";
}

function linkReason(kind: TreeEntryKind | undefined): SkipReason | undefined {
  return kind === "symlink" || kind === "submodule" ? kind : undefined;
}

/** Checks a mode and its id agree: absent mode with all-zero id, anything else with a real id. Returns the kind. */
function checkSide(mode: string, id: string): TreeEntryKind | undefined {
  const absent = mode === ZERO_MODE;
  const kind = classifyTreeMode(mode);
  if (!absent && kind === undefined) {
    throw new Error(BAD_RECORD);
  }
  const zeroId = /^0+$/.test(id);
  if (absent !== zeroId) {
    throw new Error(BAD_RECORD);
  }
  return kind;
}

/** Parses `git diff-tree -r -z --raw --no-renames --no-abbrev` output. Throws Error on a malformed record (message without raw output). */
export function parseDiffTree(output: string): TreeDiff {
  const changes: TreeChange[] = [];
  const skipped: SkippedTreeEntry[] = [];
  const parts = output.split("\0");
  // Only the single empty string after the final NUL is ignored.
  if (parts[parts.length - 1] === "") {
    parts.pop();
  }
  if (parts.length % 2 !== 0) {
    throw new Error(BAD_RECORD);
  }
  for (let i = 0; i < parts.length; i += 2) {
    const match = HEADER.exec(parts[i] ?? "");
    const path = parts[i + 1] ?? "";
    if (match === null || path === "") {
      throw new Error(BAD_RECORD);
    }
    const [, oldMode = "", newMode = "", oldId = "", newId = ""] = match;
    const oldKind = checkSide(oldMode, oldId);
    const newKind = checkSide(newMode, newId);

    if (!isSafeTreePath(path)) {
      skipped.push({ path, reason: "unsafe-path" });
      continue;
    }
    const oldFile = isRegularFile(oldKind);
    const newFile = isRegularFile(newKind);
    const newLink = linkReason(newKind);
    if (oldFile && newFile) {
      changes.push({
        path,
        kind: "modified",
        oldBlobId: oldId,
        newBlobId: newId,
      });
    } else if (newFile) {
      changes.push({ path, kind: "added", newBlobId: newId });
    } else if (oldFile) {
      changes.push({ path, kind: "deleted", oldBlobId: oldId });
      if (newLink !== undefined) {
        skipped.push({ path, reason: newLink });
      }
    } else if (newLink !== undefined) {
      skipped.push({ path, reason: newLink });
    }
  }
  return { changes, skipped };
}

/** Lists the regular files added, modified or deleted between two commits, in git's order. Renames show as a delete plus an add. Rejects with Error if either commit is not a full object ID (before running git), and with GitCommandError if git fails. */
export async function diffTrees(
  runner: GitRunner,
  fromCommit: string,
  toCommit: string,
): Promise<TreeDiff> {
  checkObjectId(fromCommit);
  checkObjectId(toCommit);
  const output = await runner.run("diff-tree", [
    "-r",
    "-z",
    "--raw",
    "--no-renames",
    "--no-abbrev",
    fromCommit,
    toCommit,
  ]);
  return parseDiffTree(output);
}
