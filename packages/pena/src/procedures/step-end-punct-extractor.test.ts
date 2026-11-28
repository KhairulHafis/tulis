import { describe, expect, it } from "vitest";
import { createExtractorRegistry } from "../extract/registry.js";
import { runExtractors } from "../extract/run-extractors.js";
import { prepareDoc } from "../prepare/prepare-doc.js";
import { createStepEndPunctExtractor } from "./step-end-punct-extractor.js";

function run(text: string) {
  const doc = prepareDoc(text, "markdown");
  if (doc.kind !== "prepared") throw new Error("not prepared");
  return {
    doc,
    result: runExtractors(
      createExtractorRegistry([createStepEndPunctExtractor()]),
      doc,
    ),
  };
}

describe("createStepEndPunctExtractor", () => {
  it("has the id procedure.step-end-punct and document scope", () => {
    const extractor = createStepEndPunctExtractor();
    expect(extractor.id).toBe("procedure.step-end-punct");
    expect(extractor.scope).toBe("document");
  });

  it("records the ending of the last sentence, and skips colons", () => {
    const { doc, result } = run(
      "1. Open it. Then wait.\n2. Close it\n3. Run:\n",
    );
    expect(result.problems).toEqual([]);
    expect(result.observations.map((o) => [o.value, o.line])).toEqual([
      ["period", 1],
      ["none", 2],
    ]);
    const first = result.observations[0];
    expect(
      first && doc.parsed.source.slice(first.range.start, first.range.end),
    ).toBe("Then wait.");
  });
});
