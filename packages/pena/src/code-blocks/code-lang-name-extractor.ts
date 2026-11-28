import type { DocumentExtractor } from "../extract/extractor.js";
import type { Finding } from "../extract/observation.js";
import { findCodeBlocks } from "./find-code-blocks.js";
import { languageGroup } from "./language-groups.js";

/** `code.lang-name.<group>`: the lower-cased language name, for known languages. */
export function createCodeLangNameExtractor(): DocumentExtractor {
  return {
    id: "code.lang-name",
    scope: "document",
    extract(doc): readonly Finding[] {
      const findings: Finding[] = [];
      for (const block of findCodeBlocks(doc)) {
        if (block.lang === undefined) continue;
        const group = languageGroup(block.lang);
        if (group === undefined) continue;
        findings.push({
          dimension: `code.lang-name.${group}`,
          value: block.lang.toLowerCase(),
          range: block.range,
        });
      }
      return findings;
    },
  };
}
