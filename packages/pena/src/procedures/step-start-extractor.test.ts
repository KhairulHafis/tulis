import { describe, expect, it } from "vitest";
import { createExtractorRegistry } from "../extract/registry.js";
import { runExtractors } from "../extract/run-extractors.js";
import { prepareDoc } from "../prepare/prepare-doc.js";
import { createStepStartExtractor } from "./step-start-extractor.js";

function run(text: string) {
  const doc = prepareDoc(text, "markdown");
  if (doc.kind !== "prepared") throw new Error("not prepared");
  return {
    doc,
    result: runExtractors(
      createExtractorRegistry([createStepStartExtractor()]),
      doc,
    ),
  };
}

describe("createStepStartExtractor", () => {
  it("has the id procedure.step-start and document scope", () => {
    const extractor = createStepStartExtractor();
    expect(extractor.id).toBe("procedure.step-start");
    expect(extractor.scope).toBe("document");
  });

  it("records each judged step on its first sentence, and skips code steps", () => {
    const { doc, result } = run(
      "1. Open it. Then wait.\n2. The file opens.\n3. ```sh\n   x\n   ```\n",
    );
    expect(result.problems).toEqual([]);
    expect(result.observations.map((o) => [o.value, o.line])).toEqual([
      ["imperative", 1],
      ["other", 2],
    ]);
    const first = result.observations[0];
    expect(
      first && doc.parsed.source.slice(first.range.start, first.range.end),
    ).toBe("Open it.");
  });
});
