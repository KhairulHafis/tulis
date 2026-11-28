import type { DocumentExtractor } from "../extract/extractor.js";
import type { Finding } from "../extract/observation.js";
import { findProcedures } from "./procedure-lists.js";
import { stepEndPunct } from "./step-end-punct.js";

/** `procedure.step-end-punct`: value `period` or `none`, one per step. */
export function createStepEndPunctExtractor(): DocumentExtractor {
  return {
    id: "procedure.step-end-punct",
    scope: "document",
    extract(doc): readonly Finding[] {
      const findings: Finding[] = [];
      for (const procedure of findProcedures(doc)) {
        for (const step of procedure.steps) {
          const sentences = step.block?.sentences ?? [];
          const last = sentences[sentences.length - 1];
          if (last === undefined) continue;
          const value = stepEndPunct(last.tokens);
          if (value === undefined) continue;
          findings.push({
            dimension: "procedure.step-end-punct",
            value,
            range: last.source,
          });
        }
      }
      return findings;
    },
  };
}
