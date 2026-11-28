import { describe, expect, it } from "vitest";
import { createExtractorRegistry } from "../extract/registry.js";
import { runExtractors } from "../extract/run-extractors.js";
import { prepareDoc } from "../prepare/prepare-doc.js";
import { createHeadingCaseExtractor } from "./heading-case-extractor.js";

function run(text: string) {
  const doc = prepareDoc(text, "markdown");
  if (doc.kind !== "prepared") throw new Error("not prepared");
  return runExtractors(
    createExtractorRegistry([createHeadingCaseExtractor()]),
    doc,
  );
}

describe("createHeadingCaseExtractor", () => {
  it("has the id heading.case and document scope", () => {
    const extractor = createHeadingCaseExtractor();
    expect(extractor.id).toBe("heading.case");
    expect(extractor.scope).toBe("document");
  });

  it("splits h1 from lower headings", () => {
    const result = run("# Install the Agent\n\n## Before you begin\n");
    expect(result.problems).toEqual([]);
    expect(result.observations.map((o) => [o.dimension, o.value])).toEqual([
      ["heading.case.h1", "title"],
      ["heading.case.h2plus", "sentence"],
    ]);
  });

  it("gives nothing when the rule is undecided", () => {
    expect(run("## Overview\n").observations).toEqual([]);
  });
});
