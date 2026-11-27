import type { VariantGroup } from "../config/variants-types.js";
import type { SentenceExtractor } from "../extract/extractor.js";
import type { Finding } from "../extract/observation.js";
import { sentenceTags } from "../prepare/sentence-tags.js";
import { createTermMatcher, type TermEntry } from "./term-matcher.js";
import { termRole } from "./verb-noun-role.js";

/**
 * The `term.verb-noun` sentence extractor over the verb-noun groups (synonym
 * groups are ignored). Dimensions `term.<group id>.verb` and
 * `term.<group id>.noun`, value from the matcher. All block kinds. Builds its
 * matcher once.
 */
export function createVerbNounExtractor(
  groups: readonly VariantGroup[],
): SentenceExtractor {
  const ids: string[] = [];
  const entries: TermEntry[] = [];
  for (const group of groups) {
    if (group.kind !== "verb-noun") {
      continue;
    }
    const number = ids.length;
    ids.push(group.id);
    entries.push({ text: group.noun, group: number });
    entries.push({ text: group.verb, group: number });
  }
  const matcher = createTermMatcher(entries);

  return {
    id: "term.verb-noun",
    scope: "sentence",
    extract(sentence, ctx): readonly Finding[] {
      const matches = matcher.find(sentence, ctx.doc.parsed.source);
      if (matches.length === 0) {
        return [];
      }
      const tags = sentenceTags(sentence);
      const startIndex = new Map<number, number>();
      const endIndex = new Map<number, number>();
      tags.forEach((token, index) => {
        if (!startIndex.has(token.source.start)) {
          startIndex.set(token.source.start, index);
        }
        endIndex.set(token.source.end, index);
      });
      const findings: Finding[] = [];
      for (const match of matches) {
        const id = ids[match.group];
        const first = startIndex.get(match.range.start);
        const last = endIndex.get(match.range.end);
        if (
          id === undefined ||
          first === undefined ||
          last === undefined ||
          last < first
        ) {
          continue;
        }
        const role = termRole(tags, first, last, match.value);
        if (role !== undefined) {
          findings.push({
            dimension: "term." + id + "." + role,
            value: match.value,
            range: match.range,
          });
        }
      }
      return findings;
    },
  };
}
