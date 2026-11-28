import type { PreparedDoc } from "../prepare/prepare-doc.js";
import { countableWords, properNounKey } from "./heading-case.js";

export { properNounKey };

export const MAX_DOC_WORD_KEYS = 10_000;
export const MAX_TOTAL_WORD_KEYS = 200_000;
export const MAX_PROPER_NOUNS = 10_000;
export const MAX_PROPER_NOUN_KEY_LENGTH = 100;
export const PROPER_NOUN_MIN_USES = 5;
export const PROPER_NOUN_MIN_SHARE = 0.9;
export const PROPER_NOUN_MIN_DOCS = 2;

export interface WordCaseCount {
  readonly upper: number;
  readonly lower: number;
}

export interface WordCaseTotal {
  readonly upper: number;
  readonly lower: number;
  /** Docs with upper > 0. */
  readonly docs: number;
}

/**
 * Counts, per word key, how often a word is capitalised or lowercase in
 * the doc's paragraphs. Start positions are not counted.
 */
export function countWordCase(doc: PreparedDoc): Map<string, WordCaseCount> {
  const counts = new Map<string, WordCaseCount>();
  for (const block of doc.blocks) {
    if (block.kind !== "paragraph") continue;
    for (const sentence of block.sentences) {
      for (const word of countableWords(sentence.tokens)) {
        if (word.atStart) continue;
        const key = properNounKey(word.text);
        if (key.length > MAX_PROPER_NOUN_KEY_LENGTH) continue;
        const before = counts.get(key);
        if (before === undefined && counts.size >= MAX_DOC_WORD_KEYS) continue;
        const upper = before?.upper ?? 0;
        const lower = before?.lower ?? 0;
        counts.set(
          key,
          word.letterCase === "upper"
            ? { upper: upper + 1, lower }
            : { upper, lower: lower + 1 },
        );
      }
    }
  }
  return counts;
}

/** Adds up per-doc counts, and counts the docs where each word was capitalised. */
export function sumWordCase(
  perDoc: Iterable<ReadonlyMap<string, WordCaseCount>>,
): Map<string, WordCaseTotal> {
  const totals = new Map<string, WordCaseTotal>();
  for (const doc of perDoc) {
    for (const [key, count] of doc) {
      const before = totals.get(key);
      if (before === undefined && totals.size >= MAX_TOTAL_WORD_KEYS) continue;
      totals.set(key, {
        upper: (before?.upper ?? 0) + count.upper,
        lower: (before?.lower ?? 0) + count.lower,
        docs: (before?.docs ?? 0) + (count.upper > 0 ? 1 : 0),
      });
    }
  }
  return totals;
}

/** The keys that are almost always capitalised mid-sentence, in several docs. */
export function learnProperNouns(
  totals: ReadonlyMap<string, WordCaseTotal>,
): ReadonlySet<string> {
  const candidates: { key: string; upper: number }[] = [];
  for (const [key, total] of totals) {
    const uses = total.upper + total.lower;
    if (uses < PROPER_NOUN_MIN_USES) continue;
    if (total.upper / uses < PROPER_NOUN_MIN_SHARE) continue;
    if (total.docs < PROPER_NOUN_MIN_DOCS) continue;
    candidates.push({ key, upper: total.upper });
  }
  candidates.sort((a, b) => {
    if (a.upper !== b.upper) return b.upper - a.upper;
    if (a.key < b.key) return -1;
    return a.key > b.key ? 1 : 0;
  });
  return new Set(candidates.slice(0, MAX_PROPER_NOUNS).map((c) => c.key));
}
