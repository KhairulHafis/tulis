import { describe, expect, it } from "vitest";
import { createExtractorRegistry } from "../extract/registry.js";
import { runExtractors } from "../extract/run-extractors.js";
import { prepareDoc } from "../prepare/prepare-doc.js";
import { createProcedureNumberingExtractor } from "./procedure-numbering-extractor.js";

function run(text: string) {
  const doc = prepareDoc(text, "markdown");
  if (doc.kind !== "prepared") throw new Error("not prepared");
  return {
    doc,
    result: runExtractors(
      createExtractorRegistry([createProcedureNumberingExtractor()]),
      doc,
    ),
  };
}

describe("createProcedureNumberingExtractor", () => {
  it("has the id procedure.numbering and document scope", () => {
    const extractor = createProcedureNumberingExtractor();
    expect(extractor.id).toBe("procedure.numbering");
    expect(extractor.scope).toBe("document");
  });

  it("records the pattern over the whole list, and skips others", () => {
    const { doc, result } = run(
      "1. Open it.\n2. Close it.\n\n---\n\n1. Open it.\n3. Close it.\n",
    );
    expect(result.problems).toEqual([]);
    expect(result.observations.map((o) => [o.value, o.line])).toEqual([
      ["sequential", 1],
    ]);
    const first = result.observations[0];
    expect(
      first && doc.parsed.source.slice(first.range.start, first.range.end),
    ).toBe("1. Open it.\n2. Close it.");
  });
});
