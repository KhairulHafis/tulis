import { describe, expect, it } from "vitest";
import { createExtractorRegistry } from "../extract/registry.js";
import { runExtractors } from "../extract/run-extractors.js";
import { prepareDoc } from "../prepare/prepare-doc.js";
import { createCodeFenceExtractor } from "./code-fence-extractor.js";

describe("createCodeFenceExtractor", () => {
  it("has the id code.fence and document scope", () => {
    const extractor = createCodeFenceExtractor();
    expect(extractor.id).toBe("code.fence");
    expect(extractor.scope).toBe("document");
  });

  it("records one finding per block over the block's range", () => {
    const text = "```sh\nx\n```\n\nText\n\n    old\n\n~~~\ny\n~~~\n";
    const doc = prepareDoc(text, "markdown");
    if (doc.kind !== "prepared") throw new Error("not prepared");
    const findings = createCodeFenceExtractor().extract(doc);
    expect(findings.map((f) => f.value)).toEqual([
      "backticks",
      "indented",
      "tildes",
    ]);
    expect(findings[0]?.range).toEqual({ start: 0, end: 11 });
    const result = runExtractors(
      createExtractorRegistry([createCodeFenceExtractor()]),
      doc,
    );
    expect(result.problems).toEqual([]);
    expect(result.observations.map((o) => o.dimension)).toEqual([
      "code.fence",
      "code.fence",
      "code.fence",
    ]);
  });

  it("records nothing without code", () => {
    const doc = prepareDoc("Just text.\n", "markdown");
    if (doc.kind !== "prepared") throw new Error("not prepared");
    expect(createCodeFenceExtractor().extract(doc)).toEqual([]);
  });
});
