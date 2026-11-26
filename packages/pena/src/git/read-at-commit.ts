import {
  openBlobReader,
  type BlobReader,
  type BlobReaderOptions,
} from "./blob-reader.js";
import type { GitRunner } from "./git-runner.js";
import { isSafeTreePath, parseLsTreeRecords } from "./list-tree.js";
import { checkObjectId } from "./ref-name.js";
import { toSafeText } from "./safe-text.js";
import { TREE_ENTRY_OBJECT_TYPE, classifyTreeMode } from "./tree-entry.js";

export type FileAtCommit =
  | {
      readonly kind: "content";
      readonly blobId: string;
      readonly content: Buffer;
    }
  | { readonly kind: "not-found" }
  | {
      readonly kind: "not-a-file";
      readonly entryKind: "folder" | "symlink" | "submodule";
    }
  | {
      readonly kind: "too-large";
      readonly blobId: string;
      readonly size: number;
    }
  | { readonly kind: "missing-object"; readonly blobId: string };

const UNEXPECTED = "Unexpected git ls-tree output";

/** Reads the bytes of one file as stored at `commit`, with no line ending or text conversion. Rejects with Error if `commit` is not a full object ID or `path` is unsafe (before running git), or if git's output is unexpected; GitCommandError passes through. */
export async function readFileAtCommit(
  runner: GitRunner,
  commit: string,
  path: string,
  options?: BlobReaderOptions,
): Promise<FileAtCommit> {
  checkObjectId(commit);
  if (!isSafeTreePath(path)) {
    throw new Error(`Unsafe path: "${toSafeText(path)}"`);
  }
  const output = await runner.run("ls-tree", ["-z", "--full-tree", commit], {
    paths: [path],
  });
  // Git may match other spellings on case-insensitive systems; only the exact path counts.
  const entries = parseLsTreeRecords(output).filter(
    (record) => record.path === path,
  );
  const entry = entries[0];
  if (entry === undefined) {
    return { kind: "not-found" };
  }
  if (entries.length > 1) {
    throw new Error(UNEXPECTED);
  }
  const kind = classifyTreeMode(entry.mode);
  if (kind === undefined || TREE_ENTRY_OBJECT_TYPE[kind] !== entry.type) {
    throw new Error(UNEXPECTED);
  }
  if (kind === "folder" || kind === "symlink" || kind === "submodule") {
    return { kind: "not-a-file", entryKind: kind };
  }

  const reader: BlobReader = openBlobReader(runner, options);
  try {
    const result = await reader.read(entry.objectId);
    switch (result.kind) {
      case "content":
        return {
          kind: "content",
          blobId: result.blobId,
          content: result.content,
        };
      case "too-large":
        return {
          kind: "too-large",
          blobId: result.blobId,
          size: result.size,
        };
      case "missing":
        return { kind: "missing-object", blobId: result.blobId };
    }
  } finally {
    await reader.close();
  }
}
