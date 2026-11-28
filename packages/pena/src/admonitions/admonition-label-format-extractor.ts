import type { DocumentExtractor } from "../extract/extractor.js";
import type { Finding } from "../extract/observation.js";
import { findAdmonitions } from "./find-admonitions.js";

/** `admonition.label-format`: the format of each bold label that has one. */
export function createAdmonitionLabelFormatExtractor(): DocumentExtractor {
  return {
    id: "admonition.label-format",
    scope: "document",
    extract(doc): readonly Finding[] {
      const findings: Finding[] = [];
      for (const admonition of findAdmonitions(doc)) {
        const label = admonition.label;
        if (label?.format !== undefined) {
          findings.push({
            dimension: "admonition.label-format",
            value: label.format,
            range: label.range,
          });
        }
      }
      return findings;
    },
  };
}
