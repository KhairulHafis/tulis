import type { DocumentExtractor } from "../extract/extractor.js";
import type { Finding } from "../extract/observation.js";
import { procedureIntro } from "./procedure-intro.js";
import { findProcedures } from "./procedure-lists.js";

/** `procedure.intro`: value `colon` or `heading`, one per top-level procedure. */
export function createProcedureIntroExtractor(): DocumentExtractor {
  return {
    id: "procedure.intro",
    scope: "document",
    extract(doc): readonly Finding[] {
      const findings: Finding[] = [];
      for (const procedure of findProcedures(doc)) {
        if (procedure.nested) continue;
        const value = procedureIntro(procedure.before);
        if (value === undefined) continue;
        const sentences = procedure.before?.sentences ?? [];
        const last = sentences[sentences.length - 1];
        if (last === undefined) continue;
        findings.push({
          dimension: "procedure.intro",
          value,
          range: last.source,
        });
      }
      return findings;
    },
  };
}
