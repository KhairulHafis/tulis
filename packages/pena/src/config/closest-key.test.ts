import { describe, expect, it } from "vitest";
import { closestKey } from "./closest-key.js";

const KEYS = ["prodBranch", "threshold", "minDocs", "maxFileSize"];

describe("closestKey", () => {
  it("suggests the near key for a typo", () => {
    expect(closestKey("thresold", KEYS)).toBe("threshold");
    expect(closestKey("minDoc", KEYS)).toBe("minDocs");
  });

  it("matches ignoring case", () => {
    expect(closestKey("MaxFileSize", KEYS)).toBe("maxFileSize");
    expect(closestKey("prodbranch", KEYS)).toBe("prodBranch");
  });

  it("lets the earlier key win a tie", () => {
    expect(closestKey("colour", ["color", "colon"])).toBe("color");
    // "catt" is one edit from both; the earlier one wins in either order.
    expect(closestKey("catt", ["cats", "catx"])).toBe("cats");
    expect(closestKey("catt", ["catx", "cats"])).toBe("catx");
  });

  it("gives no suggestion for short keys unless case-only", () => {
    expect(closestKey("ab", ["abc"])).toBeUndefined();
    expect(closestKey("AB", ["ab"])).toBe("ab");
  });

  it("gives none for unrelated, long or unmatched input", () => {
    expect(closestKey("xyz", KEYS)).toBeUndefined();
    expect(closestKey("a".repeat(101), ["a".repeat(101)])).toBeUndefined();
    expect(closestKey("threshold", [])).toBeUndefined();
  });
});
