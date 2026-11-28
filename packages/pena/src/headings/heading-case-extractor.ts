import type { DocumentExtractor } from "../extract/extractor.js";
import type { Finding } from "../extract/observation.js";
import { headingCase } from "./heading-case.js";
import { headingUnits } from "./heading-units.js";

export interface HeadingCaseOptions {
  /** Learned proper-noun keys (see `properNounKey`). */
  readonly properNouns?: ReadonlySet<string>;
}

/** `heading.case.h1` or `heading.case.h2plus`: value `sentence` or `title`. */
export function createHeadingCaseExtractor(
  options: HeadingCaseOptions = {},
): DocumentExtractor {
  return {
    id: "heading.case",
    scope: "document",
    extract(doc): readonly Finding[] {
      const findings: Finding[] = [];
      for (const unit of headingUnits(doc)) {
        const value = headingCase(unit.tokens, options.properNouns);
        if (value === undefined) continue;
        findings.push({
          dimension: `heading.case.${unit.level}`,
          value,
          range: unit.range,
        });
      }
      return findings;
    },
  };
}
