import { describe, expect, it } from "vitest";
import { isDocTypeName } from "./doc-type-name.js";

describe("isDocTypeName", () => {
  it.each(["a", "How to", "Reference_1", "a-b", "9", "A".repeat(64)])(
    "accepts %j",
    (value) => {
      expect(isDocTypeName(value)).toBe(true);
    },
  );

  it.each([
    "",
    " ",
    " a",
    "_a",
    "-a",
    "a.b",
    "a/b",
    "a\nb",
    "a\n",
    "A".repeat(65),
    "caf" + String.fromCodePoint(0xe9),
  ])("rejects %j", (value) => {
    expect(isDocTypeName(value)).toBe(false);
  });
});
