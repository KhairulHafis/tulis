import { describe, expect, it } from "vitest";
import { createExtractorRegistry } from "../extract/registry.js";
import { runExtractors } from "../extract/run-extractors.js";
import { prepareDoc } from "../prepare/prepare-doc.js";
import { createHeadingEndPunctExtractor } from "./heading-end-punct-extractor.js";

function run(text: string) {
  const doc = prepareDoc(text, "markdown");
  if (doc.kind !== "prepared") throw new Error("not prepared");
  return runExtractors(
    createExtractorRegistry([createHeadingEndPunctExtractor()]),
    doc,
  );
}

describe("createHeadingEndPunctExtractor", () => {
  it("has the id heading.end-punct and document scope", () => {
    const extractor = createHeadingEndPunctExtractor();
    expect(extractor.id).toBe("heading.end-punct");
    expect(extractor.scope).toBe("document");
  });

  it("records none, period and colon for every level", () => {
    const result = run("# Start\n\n## Next.\n\n### Last:\n");
    expect(result.problems).toEqual([]);
    expect(result.observations.map((o) => [o.dimension, o.value])).toEqual([
      ["heading.end-punct", "none"],
      ["heading.end-punct", "period"],
      ["heading.end-punct", "colon"],
    ]);
  });

  it("gives nothing for a question", () => {
    expect(run("## What is a Pod?\n").observations).toEqual([]);
  });
});
