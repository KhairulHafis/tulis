import { describe, expect, it } from "vitest";
import { createExtractorRegistry } from "../extract/registry.js";
import { runExtractors } from "../extract/run-extractors.js";
import { prepareDoc } from "../prepare/prepare-doc.js";
import { createAdmonitionSyntaxExtractor } from "./admonition-syntax-extractor.js";

describe("createAdmonitionSyntaxExtractor", () => {
  it("has the id admonition.syntax and document scope", () => {
    const extractor = createAdmonitionSyntaxExtractor();
    expect(extractor.id).toBe("admonition.syntax");
    expect(extractor.scope).toBe("document");
  });

  it("records one value per admonition over its whole range", () => {
    const doc = prepareDoc("> **Note:** A\n\n:::tip\n\nB\n\n:::\n", "markdown");
    if (doc.kind !== "prepared") throw new Error("skipped");
    const result = runExtractors(
      createExtractorRegistry([createAdmonitionSyntaxExtractor()]),
      doc,
    );
    expect(result.problems).toEqual([]);
    expect(result.observations.map((o) => o.value)).toEqual([
      "blockquote-label",
      "directive",
    ]);
    expect(result.observations.map((o) => o.line)).toEqual([1, 3]);
    const first = result.observations[0];
    expect(
      first && doc.parsed.source.slice(first.range.start, first.range.end),
    ).toBe("> **Note:** A");
  });
});
