import { describe, expect, it } from "vitest";
import { createExtractorRegistry } from "../extract/registry.js";
import { runExtractors } from "../extract/run-extractors.js";
import { prepareDoc } from "../prepare/prepare-doc.js";
import { createHeadingCaseExtractor } from "./heading-case-extractor.js";

describe("many headings", () => {
  it("hits the 10,000 cap without throwing, quickly", () => {
    const started = performance.now();
    const text = "## Install the agent\n".repeat(10_010);
    const doc = prepareDoc(text, "markdown");
    if (doc.kind !== "prepared") throw new Error("not prepared");
    const result = runExtractors(
      createExtractorRegistry([createHeadingCaseExtractor()]),
      doc,
    );
    expect(result.observations).toHaveLength(10_000);
    expect(result.problems).toEqual([
      { extractorId: "heading.case", kind: "too-many", count: 10 },
    ]);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it("never puts heading text in a value or a problem", () => {
    const doc = prepareDoc("## Secret Phrase Here\n", "markdown");
    if (doc.kind !== "prepared") throw new Error("not prepared");
    const result = runExtractors(
      createExtractorRegistry([createHeadingCaseExtractor()]),
      doc,
    );
    expect(result.observations.map((o) => o.value)).toEqual(["title"]);
    expect(JSON.stringify(result.problems)).not.toContain("Secret");
  });
});
