export type TreeEntryKind =
  "file" | "executable" | "symlink" | "submodule" | "folder";

const MODE_KINDS: Readonly<Record<string, TreeEntryKind>> = {
  "100644": "file",
  "100755": "executable",
  "120000": "symlink",
  "160000": "submodule",
  "040000": "folder",
};

/** The kind of a git tree entry mode, or undefined for a mode git doesn't use in trees. */
export function classifyTreeMode(mode: string): TreeEntryKind | undefined {
  return Object.hasOwn(MODE_KINDS, mode) ? MODE_KINDS[mode] : undefined;
}

/** The git object type each kind of entry points to. */
export const TREE_ENTRY_OBJECT_TYPE: Readonly<
  Record<TreeEntryKind, "blob" | "commit" | "tree">
> = {
  file: "blob",
  executable: "blob",
  symlink: "blob",
  submodule: "commit",
  folder: "tree",
};
