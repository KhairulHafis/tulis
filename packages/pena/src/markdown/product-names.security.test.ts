import { describe, expect, it } from "vitest";
import {
  bestTime,
  expectLinearTime,
  repeatToSize,
  timeOnce,
} from "@tulis/testkit";
import { createProductNameMatcher, findProductNames } from "./product-names.js";

const KB = 1024;
const LIMIT_LARGE = 500;

function checkScaling(
  names: string[],
  makeText: (size: number) => string,
): void {
  const matcher = createProductNameMatcher(names);
  expectLinearTime({
    prepare: (size) => {
      const text = makeText(size);
      return () => findProductNames(matcher, text);
    },
    // Probe first, with a tight limit, so a quadratic regression fails there
    // in well under a second instead of grinding through the 1 MB input.
    // Limits are for a quiet machine; 1 MB must stay well under a second.
    probe: { size: 16 * KB, limitMs: 50 },
    sizes: [64 * KB, 256 * KB, 1024 * KB],
    smallLimitMs: 100,
    largeLimitMs: LIMIT_LARGE,
    // Generous slack over linear, plus a floor for noise.
    slack: 4,
    floorMs: 50,
  });
}

// Names like "a a a ... a x12": 500 distinct names sharing a long prefix.
// Against text of that prefix every start walks the whole prefix, so the time
// is about the prefix length times the text length.
function sharedPrefixNames(pairs: number): string[] {
  const names: string[] = [];
  for (let i = 0; i < 500; i += 1) {
    names.push("a ".repeat(pairs + (i % 9)) + `x${String(i)}`);
  }
  return names;
}

describe("product name matching time", () => {
  // Names up to 24 characters: at the 100 character maximum a walk is four
  // times as deep and 1 MB alone took about 800 ms on a busy Mac, too close to
  // a second. The maximum length is covered at 64 KB in the next test.
  it("(a) names sharing a long prefix against text of that prefix", () => {
    const names = sharedPrefixNames(3);
    expect(createProductNameMatcher(names).skipped).toBe(0);
    checkScaling(names, (size) => repeatToSize("a ", size));
  });

  it("(a) the same with names of the maximum length, on a small text", () => {
    const names = sharedPrefixNames(40);
    const matcher = createProductNameMatcher(names);
    expect(matcher.skipped).toBe(0);
    expect(Math.max(...names.map((name) => name.length))).toBe(100);
    // Small on purpose: a matcher that tries every name at every position
    // needs about 25 seconds for 64 KB of this text.
    const text = repeatToSize("a ", 4 * KB);
    expect(bestTime(() => findProductNames(matcher, text))).toBeLessThan(50);
  });

  it("(b) a name followed by long whitespace runs", () => {
    checkScaling(["a b", "a b c"], (size) =>
      repeatToSize("a" + " ".repeat(40) + "\n\n\t", size),
    );
    checkScaling(["a b"], (size) => "a" + " ".repeat(size - 1));
  });

  it("(b) many walks that reach the same long whitespace run", () => {
    // 100 names "." x k + " b": every dot starts a walk that arrives at the
    // run. Without the 16 blank limit each walk would read the whole run.
    const names = Array.from(
      { length: 100 },
      (_, i) => ".".repeat(i + 1) + " b",
    );
    checkScaling(names, (size) => ".".repeat(100) + " ".repeat(size - 100));
  });

  it("(c) many near-misses", () => {
    const names = ["GitLab Runner", "Node.js", "C++", "kubectl", "Cafe"];
    checkScaling(names, (size) =>
      repeatToSize("GitLab Runne GitLabs Node.j kubect Caf ", size),
    );
  });

  it("still finds matches in the crafted text", () => {
    const matcher = createProductNameMatcher(["a a a", "a a"]);
    expect(findProductNames(matcher, "a a a a")).toEqual([
      { start: 0, end: 5 },
    ]);
  });
});

describe("names are literal", () => {
  it("matches regex-looking names only literally", () => {
    const matcher = createProductNameMatcher(["a.*b", "(x+)+"]);
    expect(matcher.skipped).toBe(0);
    expect(findProductNames(matcher, "aXXb")).toEqual([]);
    expect(findProductNames(matcher, "xxxx")).toEqual([]);
    expect(findProductNames(matcher, "see a.*b and (x+)+ end")).toEqual([
      { start: 4, end: 8 },
      { start: 13, end: 18 },
    ]);
  });

  it("handles a catastrophic-looking name on long text quickly", () => {
    const matcher = createProductNameMatcher(["(x+)+y"]);
    const text = "x".repeat(KB * 1024);
    expect(timeOnce(() => findProductNames(matcher, text))).toBeLessThan(
      LIMIT_LARGE,
    );
  });
});
