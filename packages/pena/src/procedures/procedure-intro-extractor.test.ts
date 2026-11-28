import { describe, expect, it } from "vitest";
import { createExtractorRegistry } from "../extract/registry.js";
import { runExtractors } from "../extract/run-extractors.js";
import { prepareDoc } from "../prepare/prepare-doc.js";
import { createProcedureIntroExtractor } from "./procedure-intro-extractor.js";

function run(text: string) {
  const doc = prepareDoc(text, "markdown");
  if (doc.kind !== "prepared") throw new Error("not prepared");
  return {
    doc,
    result: runExtractors(
      createExtractorRegistry([createProcedureIntroExtractor()]),
      doc,
    ),
  };
}

describe("createProcedureIntroExtractor", () => {
  it("has the id procedure.intro and document scope", () => {
    const extractor = createProcedureIntroExtractor();
    expect(extractor.id).toBe("procedure.intro");
    expect(extractor.scope).toBe("document");
  });

  it("records colon and heading intros on the last sentence, and skips nested lists", () => {
    const { doc, result } = run(
      "## Steps\n\n1. Open it.\n2. Close it.\n\nThen do this. And:\n\n1. Run it.\n   1. Stop it.\n   2. Wait.\n2. Go.\n",
    );
    expect(result.problems).toEqual([]);
    expect(result.observations.map((o) => [o.value, o.line])).toEqual([
      ["heading", 1],
      ["colon", 6],
    ]);
    const second = result.observations[1];
    expect(
      second && doc.parsed.source.slice(second.range.start, second.range.end),
    ).toBe("And:");
  });
});
