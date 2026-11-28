import type { SentenceExtractor } from "../extract/extractor.js";
import type { Finding } from "../extract/observation.js";
import { findUiLabels } from "./ui-label-format.js";

/**
 * The `ui.format` sentence extractor: how the UI label after a verb such as
 * "select" is written (bold, quotes, code, plain, hugo-shortcode). Paragraphs
 * and table cells only.
 */
export function createUiFormatExtractor(): SentenceExtractor {
  return {
    id: "ui.format",
    scope: "sentence",
    blockKinds: ["paragraph", "tableCell"],
    extract(sentence, ctx): readonly Finding[] {
      return findUiLabels(sentence.tokens, ctx.doc.parsed.source).map(
        (label) => ({
          dimension: "ui.format",
          value: label.format,
          range: { start: label.start, end: label.end },
        }),
      );
    },
  };
}
