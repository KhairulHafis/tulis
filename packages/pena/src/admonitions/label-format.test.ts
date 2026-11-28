import { describe, expect, it } from "vitest";
import { isLabelWord, labelFormat, LABEL_WORDS } from "./label-format.js";

describe("labelFormat", () => {
  it("reads title case with and without a colon", () => {
    expect(labelFormat("Note", true)).toBe("title-case-colon");
    expect(labelFormat("Note", false)).toBe("title-case");
  });

  it("reads upper case with a colon only", () => {
    expect(labelFormat("NOTE", true)).toBe("upper-case-colon");
    expect(labelFormat("NOTE", false)).toBeUndefined();
  });

  it("gives no format for lower or mixed case", () => {
    expect(labelFormat("note", true)).toBeUndefined();
    expect(labelFormat("note", false)).toBeUndefined();
    expect(labelFormat("NoTe", true)).toBeUndefined();
    expect(labelFormat("nOTE", false)).toBeUndefined();
  });

  it("reads a one-letter word as title case", () => {
    expect(labelFormat("N", true)).toBe("title-case-colon");
    expect(labelFormat("N", false)).toBe("title-case");
    expect(labelFormat("n", true)).toBeUndefined();
  });

  it("gives no format for an empty word", () => {
    expect(labelFormat("", true)).toBeUndefined();
  });
});

describe("isLabelWord", () => {
  it("knows the seven words, ignoring case", () => {
    expect(LABEL_WORDS).toHaveLength(7);
    for (const word of LABEL_WORDS) {
      expect(isLabelWord(word)).toBe(true);
      expect(isLabelWord(word.toUpperCase())).toBe(true);
    }
    expect(isLabelWord("Example")).toBe(false);
    expect(isLabelWord("")).toBe(false);
  });
});
