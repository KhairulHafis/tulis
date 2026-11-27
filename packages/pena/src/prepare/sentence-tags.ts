import { tagSentence, type TaggedToken } from "../language/tag-tokens.js";
import type { PreparedSentence } from "./prepare-doc.js";

const cache = new WeakMap<PreparedSentence, readonly TaggedToken[]>();

/** Tags on first use and remembers the result per sentence object, so each sentence is tagged at most once. */
export function sentenceTags(
  sentence: PreparedSentence,
): readonly TaggedToken[] {
  let tags = cache.get(sentence);
  if (tags === undefined) {
    tags = tagSentence(sentence.tokens);
    cache.set(sentence, tags);
  }
  return tags;
}
