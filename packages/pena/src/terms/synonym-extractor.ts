import type { VariantGroup } from "../config/variants-types.js";
import type { SentenceExtractor } from "../extract/extractor.js";
import type { Finding } from "../extract/observation.js";
import { createTermMatcher, type TermEntry } from "./term-matcher.js";

/**
 * The `term.synonyms` sentence extractor over the synonym groups (verb-noun
 * groups are ignored). Dimension `term.<group id>`, value from the matcher.
 * All block kinds. Builds its matcher once.
 */
export function createSynonymExtractor(
  groups: readonly VariantGroup[],
): SentenceExtractor {
  const dimensions: string[] = [];
  const entries: TermEntry[] = [];
  for (const group of groups) {
    if (group.kind !== "synonym") {
      continue;
    }
    const number = dimensions.length;
    dimensions.push("term." + group.id);
    for (const text of group.variants) {
      entries.push({ text, group: number });
    }
  }
  const matcher = createTermMatcher(entries);

  return {
    id: "term.synonyms",
    scope: "sentence",
    extract(sentence, ctx): readonly Finding[] {
      const findings: Finding[] = [];
      for (const match of matcher.find(sentence, ctx.doc.parsed.source)) {
        const dimension = dimensions[match.group];
        if (dimension !== undefined) {
          findings.push({ dimension, value: match.value, range: match.range });
        }
      }
      return findings;
    },
  };
}
