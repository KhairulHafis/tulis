import { describe, expect, it } from "vitest";
import { findIgnoredRanges, MAX_IGNORE_WARNINGS } from "./ignored-ranges.js";
import { parseMarkdown, type ParsedMarkdown } from "./parse-markdown.js";

const COUNT = 4_000;

function parse(text: string): ParsedMarkdown {
  const result = parseMarkdown(text, "markdown");
  if (result.kind !== "parsed") {
    throw new Error("failed to parse: " + result.problem);
  }
  return result;
}

describe("findIgnoredRanges on hostile input", () => {
  it("stays linear for stacked next comments", () => {
    const parsed = parse(
      "<!-- tulis-ignore -->\n".repeat(COUNT) + "The paragraph.\n",
    );
    const started = performance.now();
    const scan = findIgnoredRanges(parsed);
    const elapsed = performance.now() - started;
    expect(scan.ignored).toHaveLength(COUNT);
    expect(
      scan.ignored.every(
        (r) => parsed.source.slice(r.start, r.end) === "The paragraph.",
      ),
    ).toBe(true);
    expect(scan.warnings).toEqual([]);
    expect(elapsed).toBeLessThan(500);
  });

  // Guard: the stack walk is linear today; this fails if someone adds a per-comment rescan.
  it("handles deeply repeated nested starts and ends", () => {
    const parsed = parse(
      "<!-- tulis-ignore-start -->\n\n".repeat(COUNT) +
        "<!-- tulis-ignore-end -->\n\n".repeat(COUNT),
    );
    const started = performance.now();
    const scan = findIgnoredRanges(parsed);
    expect(performance.now() - started).toBeLessThan(500);
    expect(scan.ignored).toHaveLength(COUNT);
    expect(scan.warnings).toEqual([]);
  });

  it("handles many unclosed starts and caps the warnings", () => {
    const parsed = parse("<!-- tulis-ignore-start -->\n\n".repeat(COUNT));
    const started = performance.now();
    const scan = findIgnoredRanges(parsed);
    expect(performance.now() - started).toBeLessThan(500);
    expect(scan.ignored).toHaveLength(COUNT);
    expect(scan.warnings).toHaveLength(MAX_IGNORE_WARNINGS);
    expect(scan.moreWarnings).toBe(COUNT - MAX_IGNORE_WARNINGS);
  });

  it("handles many inline comments in one paragraph", () => {
    const parsed = parse("a <!-- tulis-ignore --> ".repeat(COUNT) + "end\n");
    const started = performance.now();
    const scan = findIgnoredRanges(parsed);
    expect(performance.now() - started).toBeLessThan(500);
    expect(scan.ignored).toEqual([]);
    expect(scan.warnings).toHaveLength(MAX_IGNORE_WARNINGS);
    expect(scan.moreWarnings).toBe(COUNT - MAX_IGNORE_WARNINGS);
  });
});
