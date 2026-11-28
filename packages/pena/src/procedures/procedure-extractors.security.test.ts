import { expectLinearTime } from "@tulis/testkit";
import { describe, expect, it } from "vitest";
import { createExtractorRegistry } from "../extract/registry.js";
import { runExtractors } from "../extract/run-extractors.js";
import { prepareDoc, type PreparedDoc } from "../prepare/prepare-doc.js";
import { createProcedureIntroExtractor } from "./procedure-intro-extractor.js";
import { createProcedureNumberingExtractor } from "./procedure-numbering-extractor.js";
import { createStepEndPunctExtractor } from "./step-end-punct-extractor.js";
import { createStepStartExtractor } from "./step-start-extractor.js";

const registry = createExtractorRegistry([
  createProcedureNumberingExtractor(),
  createStepStartExtractor(),
  createStepEndPunctExtractor(),
  createProcedureIntroExtractor(),
]);

function prepared(text: string): PreparedDoc {
  const doc = prepareDoc(text, "markdown");
  if (doc.kind !== "prepared") {
    throw new Error("not prepared");
  }
  return doc;
}

/** Many three-step lists, each with a colon intro. */
function manyProcedures(size: number): string {
  return "To go:\n\n1. Open it.\n2. Run it.\n3. Stop it.\n\n".repeat(size);
}

describe("procedure extractors stay bounded", () => {
  // Guard against big blowups only (hundreds of walks). That the four
  // extractors share one walk is pinned by the "caches per doc" test in
  // procedure-lists.test.ts, not by this timing.
  it("keeps the runner linear and every finding valid", () => {
    expectLinearTime({
      // A shallow copy is a new cache key, so each run walks the doc again.
      prepare: (size) => {
        const doc = prepared(manyProcedures(size));
        return () => runExtractors(registry, { ...doc });
      },
      probe: { size: 500, limitMs: 120 },
      sizes: [125, 250, 500],
      smallLimitMs: 120,
      largeLimitMs: 120,
      slack: 4,
      floorMs: 10,
    });
  });

  it("reports no problems on a doc of many procedures", () => {
    const result = runExtractors(registry, prepared(manyProcedures(300)));
    expect(result.problems).toEqual([]);
    expect(result.observations.length).toBe(300 * 8);
  });

  it("hits the 10,000 cap cleanly with more than 10,000 steps", () => {
    const steps = "1. Run it.\n".repeat(10_050);
    const result = runExtractors(registry, prepared(steps));
    expect(result.problems.filter((p) => p.kind === "too-many")).toEqual([
      { extractorId: "procedure.step-start", kind: "too-many", count: 50 },
      { extractorId: "procedure.step-end-punct", kind: "too-many", count: 50 },
    ]);
    expect(result.problems.some((p) => p.kind === "threw")).toBe(false);
  });
});
