import type { DocumentExtractor } from "../extract/extractor.js";
import type { Finding } from "../extract/observation.js";
import { findCodeBlocks } from "./find-code-blocks.js";

/** `code.fence`: `backticks`, `tildes` or `indented`, one per code block. */
export function createCodeFenceExtractor(): DocumentExtractor {
  return {
    id: "code.fence",
    scope: "document",
    extract(doc): readonly Finding[] {
      return findCodeBlocks(doc).map((block) => ({
        dimension: "code.fence",
        value: block.fence,
        range: block.range,
      }));
    },
  };
}
