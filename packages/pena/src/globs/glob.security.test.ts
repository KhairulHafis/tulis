import { describe, expect, it } from "vitest";
import { bestTime, expectLinearTime } from "@tulis/testkit";
import { compileGlob } from "./glob.js";

/** Settings shared by the timing checks: sizes grow 8 times, each run stays well under a second. */
function linear(prepare: (size: number) => () => unknown): void {
  expectLinearTime({
    prepare,
    probe: { size: 500, limitMs: 50 },
    sizes: [500, 1000, 2000, 4000],
    smallLimitMs: 50,
    largeLimitMs: 300,
    slack: 4,
    floorMs: 30,
  });
}

describe("matching takes linear time", () => {
  it("many stars against a name that almost matches", () => {
    const pattern = "*a".repeat(20) + "*b";
    const glob = compileGlob(pattern);
    linear((size) => {
      const name = "a".repeat(size);
      return () => {
        expect(glob.matches(name)).toBe(false);
      };
    });
  });

  it("the case that froze picomatch: *a*a*a*a*b against 250 characters", () => {
    const glob = compileGlob("*a*a*a*a*b");
    const started = performance.now();
    expect(glob.matches("a".repeat(250))).toBe(false);
    expect(performance.now() - started).toBeLessThan(100);
  });

  it("many brace groups followed by a star", () => {
    const glob = compileGlob("{a,b}".repeat(80) + "*z");
    linear((size) => {
      const name = "ab".repeat(40) + "x".repeat(size);
      return () => {
        expect(glob.matches(name)).toBe(false);
      };
    });
  });

  it("many ** segments against long paths", () => {
    const glob = compileGlob(Array(40).fill("**/a").join("/"));
    linear((size) => {
      const path = "a/".repeat(size / 2) + "b";
      return () => {
        expect(glob.matches(path)).toBe(false);
      };
    });
  });

  it("many ** segments that do match", () => {
    const glob = compileGlob(Array(40).fill("**/a").join("/"));
    linear((size) => {
      const path = "a/".repeat(size / 2) + "a";
      return () => {
        expect(glob.matches(path)).toBe(true);
      };
    });
  });

  it("a 500 character pattern against a 4,096 character path", () => {
    const pattern = "*a".repeat(249) + "*b";
    expect(pattern).toHaveLength(500);
    const glob = compileGlob(pattern);
    const path = "a".repeat(4096);
    expect(glob.matches(path)).toBe(false);
    // Best of three runs, so a busy machine does not fail the test. The
    // limit is about 7 times what this takes on a Mac (30 to 45 ms), for
    // slower CI; a backtracking matcher never finishes this input.
    expect(bestTime(() => glob.matches(path))).toBeLessThan(300);
  });

  it("a 500 character pattern of nested braces", () => {
    const pattern = "{a,".repeat(100) + "b" + "}".repeat(100) + "*c";
    expect(pattern.length).toBeLessThanOrEqual(500);
    const glob = compileGlob(pattern);
    const name = "a".repeat(4000);
    expect(glob.matches(name)).toBe(false);
    expect(bestTime(() => glob.matches(name))).toBeLessThan(300);
  });
});

describe("hostile patterns compile quickly", () => {
  it.each([
    ["open braces", "{".repeat(500)],
    ["open brackets", "[".repeat(500)],
    ["nested open groups with commas", "{a,".repeat(166)],
    ["alternating braces and brackets", "{[,".repeat(166)],
    ["stars", "*".repeat(500)],
    ["double stars", "**/".repeat(166)],
  ])("%s", (_name, pattern) => {
    const started = performance.now();
    const glob = compileGlob(pattern);
    glob.matches("a/b/c.md");
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe("patterns are never run as code", () => {
  it("regular expression characters are plain characters", () => {
    expect(compileGlob("a.b+c^d$e").matches("a.b+c^d$e")).toBe(true);
    expect(compileGlob("a.b").matches("axb")).toBe(false);
    expect(compileGlob("(a+)+$").matches("(a+)+$")).toBe(true);
  });
});
