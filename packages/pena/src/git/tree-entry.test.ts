import { describe, expect, it } from "vitest";
import {
  TREE_ENTRY_OBJECT_TYPE,
  classifyTreeMode,
  type TreeEntryKind,
} from "./tree-entry.js";

describe("classifyTreeMode", () => {
  it("maps each known mode to its kind", () => {
    expect(classifyTreeMode("100644")).toBe("file");
    expect(classifyTreeMode("100755")).toBe("executable");
    expect(classifyTreeMode("120000")).toBe("symlink");
    expect(classifyTreeMode("160000")).toBe("submodule");
    expect(classifyTreeMode("040000")).toBe("folder");
  });

  it("gives undefined for unknown modes", () => {
    for (const mode of [
      "100664",
      "",
      "040755",
      "1006440",
      "toString",
      "__proto__",
    ]) {
      expect(classifyTreeMode(mode)).toBeUndefined();
    }
  });
});

describe("TREE_ENTRY_OBJECT_TYPE", () => {
  it("gives the object type of each kind", () => {
    const expected: Record<TreeEntryKind, string> = {
      file: "blob",
      executable: "blob",
      symlink: "blob",
      submodule: "commit",
      folder: "tree",
    };
    expect(TREE_ENTRY_OBJECT_TYPE).toEqual(expected);
  });
});
