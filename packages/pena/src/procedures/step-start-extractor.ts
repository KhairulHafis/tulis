import type { DocumentExtractor } from "../extract/extractor.js";
import type { Finding } from "../extract/observation.js";
import { findProcedures } from "./procedure-lists.js";

/** `procedure.step-start`: value `imperative` or `other`, one per judged step. */
export function createStepStartExtractor(): DocumentExtractor {
  return {
    id: "procedure.step-start",
    scope: "document",
    extract(doc): readonly Finding[] {
      const findings: Finding[] = [];
      for (const procedure of findProcedures(doc)) {
        for (const step of procedure.steps) {
          if (step.start === undefined || step.firstSentence === undefined) {
            continue;
          }
          findings.push({
            dimension: "procedure.step-start",
            value: step.start,
            range: step.firstSentence.source,
          });
        }
      }
      return findings;
    },
  };
}
