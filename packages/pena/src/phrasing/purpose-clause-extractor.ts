import type { SentenceExtractor } from "../extract/extractor.js";
import type { Finding } from "../extract/observation.js";
import { sentenceTags } from "../prepare/sentence-tags.js";
import { findPurposeClause, mayHavePurposeClause } from "./purpose-clause.js";

/**
 * The `phrasing.purpose-clause` sentence extractor: value `start` or `end`.
 * Paragraphs and table cells only. Sentences that cannot hold one are skipped
 * before the costly tagging (see `mayHavePurposeClause`).
 */
export function createPurposeClauseExtractor(): SentenceExtractor {
  return {
    id: "phrasing.purpose-clause",
    scope: "sentence",
    blockKinds: ["paragraph", "tableCell"],
    extract(sentence): readonly Finding[] {
      if (!mayHavePurposeClause(sentence.tokens)) {
        return [];
      }
      const tags = sentenceTags(sentence);
      const clause = findPurposeClause(tags);
      const first = clause === undefined ? undefined : tags[clause.first];
      const last = clause === undefined ? undefined : tags[clause.last];
      if (clause === undefined || first === undefined || last === undefined) {
        return [];
      }
      return [
        {
          dimension: "phrasing.purpose-clause",
          value: clause.position,
          range: { start: first.source.start, end: last.source.end },
        },
      ];
    },
  };
}
