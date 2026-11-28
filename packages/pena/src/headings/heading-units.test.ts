import { describe, expect, it } from "vitest";
import {
  prepareDoc,
  type PreparedDoc,
  type PreparedTitle,
} from "../prepare/prepare-doc.js";
import { headingUnits } from "./heading-units.js";

function prepared(text: string, syntax: "markdown" | "mdx" = "markdown") {
  const result = prepareDoc(text, syntax);
  if (result.kind !== "prepared") {
    throw new Error("expected a prepared doc, got " + result.reason);
  }
  return result;
}

function words(doc: PreparedDoc): string[][] {
  return headingUnits(doc).map((u) => u.tokens.map((t) => t.text));
}

describe("headingUnits", () => {
  it("splits depth 1 from depth 2 to 6", () => {
    const doc = prepared("# One\n\n## Two\n\n###### Six\n");
    expect(headingUnits(doc).map((u) => u.level)).toEqual([
      "h1",
      "h2plus",
      "h2plus",
    ]);
  });

  it("uses the sentence source as the range", () => {
    const text = "Intro.\n\n## Two words\n";
    const doc = prepared(text);
    const [unit] = headingUnits(doc);
    expect(unit).toBeDefined();
    expect(text.slice(unit?.range.start, unit?.range.end)).toBe("Two words");
  });

  it("puts the frontmatter title first, as h1", () => {
    const text = "---\ntitle: Install the Agent\n---\n\n## Next\n";
    const doc = prepared(text);
    const units = headingUnits(doc);
    expect(units.map((u) => u.level)).toEqual(["h1", "h2plus"]);
    expect(words(doc)[0]).toEqual(["Install", "the", "Agent"]);
    const range = units[0]?.range;
    expect(text.slice(range?.start, range?.end)).toContain("Install the Agent");
  });

  it("ignores the frontmatter title when an H1 exists", () => {
    const doc = prepared("---\ntitle: Other\n---\n\n# Real\n");
    expect(words(doc)).toEqual([["Real"]]);
    expect(doc.title?.from satisfies PreparedTitle["from"] | undefined).toBe(
      "h1",
    );
  });

  it("is empty for a doc with no headings and no title", () => {
    expect(headingUnits(prepared("Just text.\n"))).toEqual([]);
  });

  it("skips non-heading blocks", () => {
    expect(words(prepared("Some text.\n\n## Head\n"))).toEqual([["Head"]]);
  });
});
