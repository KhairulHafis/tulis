import type { DocumentExtractor } from "../extract/extractor.js";
import type { Finding } from "../extract/observation.js";
import { findCodeBlocks } from "./find-code-blocks.js";
import { languageGroup } from "./language-groups.js";
import { shellPrompt } from "./shell-prompt.js";

/** `code.shell-prompt`: `dollar` or `none`, one per shell block that has a deciding line. */
export function createCodeShellPromptExtractor(): DocumentExtractor {
  return {
    id: "code.shell-prompt",
    scope: "document",
    extract(doc): readonly Finding[] {
      const findings: Finding[] = [];
      for (const block of findCodeBlocks(doc)) {
        if (block.lang === undefined) continue;
        if (languageGroup(block.lang) !== "shell") continue;
        const value = shellPrompt(block.value);
        if (value === undefined) continue;
        findings.push({
          dimension: "code.shell-prompt",
          value,
          range: block.range,
        });
      }
      return findings;
    },
  };
}
