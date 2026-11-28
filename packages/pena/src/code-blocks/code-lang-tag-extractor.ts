import type { DocumentExtractor } from "../extract/extractor.js";
import type { Finding } from "../extract/observation.js";
import { findCodeBlocks } from "./find-code-blocks.js";

/** `code.lang-tag`: `present` or `missing`, one per fenced code block. */
export function createCodeLangTagExtractor(): DocumentExtractor {
  return {
    id: "code.lang-tag",
    scope: "document",
    extract(doc): readonly Finding[] {
      const findings: Finding[] = [];
      for (const block of findCodeBlocks(doc)) {
        if (block.fence === "indented") continue;
        findings.push({
          dimension: "code.lang-tag",
          value: block.lang === undefined ? "missing" : "present",
          range: block.range,
        });
      }
      return findings;
    },
  };
}
