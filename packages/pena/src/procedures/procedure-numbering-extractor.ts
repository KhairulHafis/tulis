import type { DocumentExtractor } from "../extract/extractor.js";
import type { Finding } from "../extract/observation.js";
import { procedureNumbering } from "./numbering.js";
import { findProcedures } from "./procedure-lists.js";

/** `procedure.numbering`: value `sequential` or `all-ones`, one per procedure. */
export function createProcedureNumberingExtractor(): DocumentExtractor {
  return {
    id: "procedure.numbering",
    scope: "document",
    extract(doc): readonly Finding[] {
      const findings: Finding[] = [];
      for (const procedure of findProcedures(doc)) {
        const value = procedureNumbering(
          procedure.steps.map((step) => step.number),
        );
        if (value === undefined) continue;
        findings.push({
          dimension: "procedure.numbering",
          value,
          range: procedure.range,
        });
      }
      return findings;
    },
  };
}
