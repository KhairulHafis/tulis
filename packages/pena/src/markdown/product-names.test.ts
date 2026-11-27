import { describe, expect, it } from "vitest";
import {
  MAX_PRODUCT_NAME_LENGTH,
  MAX_PRODUCT_NAMES,
  createProductNameMatcher,
  findProductNames,
} from "./product-names.js";

function find(names: string[], text: string): string[] {
  const matcher = createProductNameMatcher(names);
  return findProductNames(matcher, text).map((m) => text.slice(m.start, m.end));
}

describe("findProductNames", () => {
  it("finds a single name with offsets", () => {
    const matcher = createProductNameMatcher(["GitLab"]);
    expect(findProductNames(matcher, "Use GitLab now")).toEqual([
      { start: 4, end: 10 },
    ]);
  });

  it("finds several names and repeats", () => {
    expect(find(["GitLab", "kubectl"], "kubectl and GitLab, GitLab")).toEqual([
      "kubectl",
      "GitLab",
      "GitLab",
    ]);
  });

  it("returns nothing for an empty list", () => {
    const matcher = createProductNameMatcher([]);
    expect(matcher.skipped).toBe(0);
    expect(findProductNames(matcher, "GitLab")).toEqual([]);
  });

  it("prefers the longest name", () => {
    expect(
      find(["GitLab", "GitLab Runner"], "the GitLab Runner settings"),
    ).toEqual(["GitLab Runner"]);
    expect(find(["GitLab", "GitLab Runner"], "GitLab Run")).toEqual(["GitLab"]);
  });

  it("is case sensitive", () => {
    expect(find(["GitLab"], "gitlab GITLAB")).toEqual([]);
  });

  it("does not match inside longer words", () => {
    expect(find(["GitLab"], "GitLabs xGitLab GitLab9 _GitLab")).toEqual([
      "GitLab",
    ]);
    expect(find(["GitLab"], "(GitLab) GitLab-ce")).toEqual([
      "GitLab",
      "GitLab",
    ]);
  });

  it("handles names that start or end with punctuation", () => {
    expect(find([".NET"], "use .NET today")).toEqual([".NET"]);
    expect(find([".NET"], "use x.NET today")).toEqual([".NET"]);
    expect(find(["C++"], "C++ code")).toEqual(["C++"]);
    expect(find(["C++"], "C++code")).toEqual(["C++"]);
    expect(find(["Node.js"], "Node.js, Node.jsx")).toEqual(["Node.js"]);
  });

  it("applies word rules to non-ASCII letters, marks and digits", () => {
    expect(find(["Café"], "un Café noir")).toEqual(["Café"]);
    expect(find(["Café"], "Cafés")).toEqual([]);
    expect(find(["Café"], "Cafée")).toEqual([]);
    expect(find(["Café"], "éCafé")).toEqual([]);
    expect(find(["Café"], "Café\u0301")).toEqual([]);
    expect(find(["Café"], "ÀCafé")).toEqual([]);
    expect(find(["Café"], "Café\u0663")).toEqual([]);
    expect(find(["Café"], "Café-bar")).toEqual(["Café"]);
    expect(find(["𝒜pp"], "a𝒜pp 𝒜pp")).toEqual(["𝒜pp"]);
  });

  it("reads whole code points at word boundaries", () => {
    expect(find(["pp"], "\u{1D49C}pp pp")).toEqual(["pp"]);
    expect(find(["App"], "App\u{1D7D9} App\u{1F600}")).toEqual(["App"]);
    expect(find(["x\u{1D49C}"], "x\u{1D49C}\u{1D49C} x\u{1D49C}")).toEqual([
      "x\u{1D49C}",
    ]);
  });

  it("judges each name by its own first character when they share a surrogate", () => {
    // U+1F100 is a digit, U+1F170 is a symbol; both start with the unit D83C.
    const digit = "\u{1F100}x";
    const symbol = "\u{1F170}x";
    for (const names of [
      [digit, symbol],
      [symbol, digit],
    ]) {
      expect(find(names, "a" + symbol)).toEqual([symbol]);
      expect(find(names, "a" + digit)).toEqual([]);
    }
  });

  it("matches names made only of punctuation anywhere", () => {
    expect(find(["++"], "C++ a++b")).toEqual(["++", "++"]);
  });

  it("matches a space across a hard wrap", () => {
    expect(find(["GitLab Runner"], "GitLab\nRunner")).toEqual([
      "GitLab\nRunner",
    ]);
    expect(find(["GitLab Runner"], "GitLab\r\nRunner")).toEqual([
      "GitLab\r\nRunner",
    ]);
    expect(find(["GitLab Runner"], "GitLab\rRunner")).toEqual([
      "GitLab\rRunner",
    ]);
    expect(find(["GitLab Runner"], "GitLab \t\n  Runner")).toEqual([
      "GitLab \t\n  Runner",
    ]);
  });

  it("limits the gap to 16 blanks and one line break", () => {
    expect(find(["a b"], "a" + " ".repeat(16) + "b")).toHaveLength(1);
    expect(find(["a b"], "a" + " ".repeat(17) + "b")).toEqual([]);
    expect(find(["a b"], "a" + "\t".repeat(17) + "b")).toEqual([]);
    expect(find(["a b"], "a\n\nb")).toEqual([]);
    expect(find(["a b"], "a\r\n\r\nb")).toEqual([]);
    expect(find(["a b"], "a\n\rb")).toEqual([]);
    expect(find(["a b"], "a\u00a0b")).toEqual([]);
  });

  it("falls back to a shorter name when the long one fails", () => {
    expect(find(["a", "a b c"], "a b d")).toEqual(["a"]);
  });

  it("never returns overlapping matches", () => {
    const text = "ab ab ab abab ba b ab";
    const matcher = createProductNameMatcher(["ab", "ab ab", "b a", "abab"]);
    const matches = findProductNames(matcher, text);
    expect(matches.length).toBeGreaterThan(0);
    for (let i = 1; i < matches.length; i += 1) {
      const prev = matches[i - 1];
      const cur = matches[i];
      expect(prev && cur && prev.end <= cur.start).toBe(true);
    }
    expect(find(["aa", "aaa"], "aaaaa")).toEqual([]);
    expect(find(["a.a", ".a."], "a.a.a")).toEqual(["a.a"]);
  });
});

describe("createProductNameMatcher", () => {
  it("normalises whitespace", () => {
    const matcher = createProductNameMatcher(["  GitLab \t\n  Runner  "]);
    expect(matcher.skipped).toBe(0);
    expect(findProductNames(matcher, "GitLab Runner")).toHaveLength(1);
  });

  it("counts duplicates after normalising", () => {
    const matcher = createProductNameMatcher(["A  B", "A B", " A B "]);
    expect(matcher.skipped).toBe(2);
  });

  it("keeps names that differ only by case", () => {
    expect(createProductNameMatcher(["Go", "go"]).skipped).toBe(0);
  });

  it("skips empty and blank names", () => {
    expect(createProductNameMatcher(["", "   ", "\n\t"]).skipped).toBe(3);
  });

  it("skips names that are too long and keeps the longest allowed", () => {
    const ok = "a".repeat(MAX_PRODUCT_NAME_LENGTH);
    const matcher = createProductNameMatcher([ok, ok + "a"]);
    expect(matcher.skipped).toBe(1);
    expect(findProductNames(matcher, ok)).toHaveLength(1);
  });

  it("measures length after normalising", () => {
    const padded = " ".repeat(50) + "a".repeat(MAX_PRODUCT_NAME_LENGTH);
    expect(createProductNameMatcher([padded]).skipped).toBe(0);
  });

  it("skips names with control, separator, bidi or BOM characters", () => {
    const bad = [
      "a\u0000b",
      "a\u0007b",
      "a\u007fb",
      "a\u0085b",
      "a\u2028b",
      "a\u2029b",
      "a\u200eb",
      "a\u200fb",
      "a\u202ab",
      "a\u202eb",
      "a\u2066b",
      "a\u2069b",
      "a\ufeffb",
      "\ufeffab",
    ];
    const matcher = createProductNameMatcher(bad);
    expect(matcher.skipped).toBe(bad.length);
    expect(findProductNames(matcher, bad.join(" "))).toEqual([]);
  });

  it("caps the number of names and counts the rest as skipped", () => {
    const names = Array.from(
      { length: MAX_PRODUCT_NAMES + 3 },
      (_, i) => `n${String(i)}x`,
    );
    const matcher = createProductNameMatcher(names);
    expect(matcher.skipped).toBe(3);
    expect(find(names, `n${String(MAX_PRODUCT_NAMES - 1)}x`)).toHaveLength(1);
    expect(find(names, `n${String(MAX_PRODUCT_NAMES)}x`)).toEqual([]);
  });

  it("does not count skipped names against the cap", () => {
    const names = [
      "",
      ...Array.from({ length: MAX_PRODUCT_NAMES }, (_, i) => `n${String(i)}x`),
    ];
    expect(createProductNameMatcher(names).skipped).toBe(1);
  });

  it("rejects a matcher it did not create", () => {
    expect(() => findProductNames({ skipped: 0 }, "x")).toThrow(TypeError);
  });
});
