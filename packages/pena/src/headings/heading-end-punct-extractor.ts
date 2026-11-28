import type { DocumentExtractor } from "../extract/extractor.js";
import type { Finding } from "../extract/observation.js";
import { headingEndPunct } from "./heading-end-punct.js";
import { headingUnits } from "./heading-units.js";

/** `heading.end-punct`: value `none`, `period` or `colon`. */
export function createHeadingEndPunctExtractor(): DocumentExtractor {
  return {
    id: "heading.end-punct",
    scope: "document",
    extract(doc): readonly Finding[] {
      const findings: Finding[] = [];
      for (const unit of headingUnits(doc)) {
        const value = headingEndPunct(unit.tokens);
        if (value === undefined) continue;
        findings.push({
          dimension: "heading.end-punct",
          value,
          range: unit.range,
        });
      }
      return findings;
    },
  };
}
