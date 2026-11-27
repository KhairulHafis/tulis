import type { TaggedToken } from "../language/tag-tokens.js";

export type TermRole = "verb" | "noun";

const DETERMINERS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "the",
  "this",
  "these",
  "those",
  "each",
  "every",
  "any",
  "no",
  "some",
  "another",
  "its",
  "your",
  "my",
  "our",
  "their",
  "his",
  "her",
]);

const OBJECT_PRONOUNS: ReadonlySet<string> = new Set([
  "it",
  "them",
  "us",
  "me",
]);

const VERB_BEFORE: ReadonlySet<string> = new Set([
  "to",
  "can",
  "could",
  "must",
  "should",
  "will",
  "would",
  "may",
  "might",
  "shall",
  "please",
  "you",
  "we",
  "they",
  "i",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "isn't",
  "aren't",
  "don't",
  "do",
  "does",
  "cannot",
]);

const MODIFIER_TARGETS: ReadonlySet<string> = new Set([
  "noun",
  "properNoun",
  "adjective",
  "placeholder",
]);

const NOUN_LIKE: ReadonlySet<string> = new Set([
  "noun",
  "properNoun",
  "placeholder",
  "number",
]);

/** How many adverb tokens rule 4 may skip between a verb-before word and the match. */
const MAX_ADVERBS_BEFORE = 2;

/** How many adjective or adverb tokens rule 2 may skip. */
const MAX_SKIPPED_MODIFIERS = 3;

function lower(token: TaggedToken | undefined): string | undefined {
  return token?.text.toLowerCase();
}

const CURLY_APOSTROPHE = String.fromCodePoint(0x2019);

/** Words whose "'s" is a contraction ("that's set up"), not a possessive. */
const CONTRACTION_BASES: ReadonlySet<string> = new Set([
  "that",
  "it",
  "what",
  "there",
  "here",
  "let",
  "who",
  "he",
  "she",
  "where",
  "how",
  "everything",
  "nothing",
  "something",
]);

function isPossessive(word: string): boolean {
  if (!word.endsWith("'s") && !word.endsWith(CURLY_APOSTROPHE + "s")) {
    return false;
  }
  return !CONTRACTION_BASES.has(word.slice(0, -2));
}

function isDeterminer(word: string): boolean {
  return DETERMINERS.has(word) || isPossessive(word);
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[ -]/u)
    .filter((word) => word !== "");
}

/**
 * Decides whether one use of a verb-noun term acts as a verb or a noun, from
 * the words around it. Returns undefined when the rules cannot tell.
 * tags: sentenceTags(sentence). first/last: indexes of the match's first and
 * last token in tags. value: the matcher's value for this match.
 */
export function termRole(
  tags: readonly TaggedToken[],
  first: number,
  last: number,
  value: string,
): TermRole | undefined {
  const firstToken = tags[first];
  if (firstToken === undefined) {
    return undefined;
  }
  const matched = tags.slice(first, last + 1);
  const hasHyphen = matched.some((token) => token.text.includes("-"));
  const isOpen = !hasHyphen && last > first;
  const before = tags[first - 1];
  const after = tags[last + 1];
  const beforeWord = lower(before);
  const afterWord = lower(after);

  // Rule 0: skip.
  if (hasHyphen && after !== undefined && MODIFIER_TARGETS.has(after.pos)) {
    return undefined;
  }
  if (
    isOpen &&
    (firstToken.pos === "adverb" || firstToken.pos === "preposition")
  ) {
    return undefined;
  }
  if (
    isOpen &&
    before?.pos === "verb" &&
    beforeWord !== undefined &&
    !VERB_BEFORE.has(beforeWord)
  ) {
    return undefined;
  }

  // Rule 1: inflection.
  const matchedWords = words(matched.map((token) => token.text).join(" "));
  const valueWords = words(value);
  const matchedFirst = matchedWords[0];
  const valueFirst = valueWords[0];
  if (matchedFirst !== undefined && valueFirst !== undefined) {
    if (matchedWords.length >= 2) {
      if (matchedFirst !== valueFirst) {
        return "verb";
      }
    } else if (
      matchedFirst !== valueFirst &&
      (matchedFirst === valueFirst + "s" || matchedFirst === valueFirst + "es")
    ) {
      return "noun";
    }
  }

  // Rule 0d (after rule 1, so "The user logs in" stays a verb): the first
  // word of an open form belongs to a noun phrase ("a job log in full screen").
  if (isOpen && before?.pos === "noun") {
    const twoBefore = lower(tags[first - 2]);
    if (twoBefore !== undefined && isDeterminer(twoBefore)) {
      return undefined;
    }
  }

  // Rule 2: noun phrase before.
  let index = first - 1;
  let skipped = 0;
  while (index >= 0 && skipped < MAX_SKIPPED_MODIFIERS) {
    const pos = tags[index]?.pos;
    if (pos !== "adjective" && pos !== "adverb") {
      break;
    }
    index -= 1;
    skipped += 1;
  }
  const phraseWord = lower(tags[index]);
  if (phraseWord !== undefined && isDeterminer(phraseWord)) {
    return "noun";
  }

  // Rule 3: verb signal after.
  if (afterWord !== undefined) {
    if (DETERMINERS.has(afterWord) || OBJECT_PRONOUNS.has(afterWord)) {
      return "verb";
    }
    if (afterWord === "into") {
      return "verb";
    }
    if (afterWord === "to") {
      // "to" before a verb is a purpose clause, unless the sentence starts
      // with the match ("Login to see your settings.").
      const isPurpose = tags[last + 2]?.pos === "verb";
      if (!isPurpose || before === undefined) {
        return "verb";
      }
    }
  }

  // Rule 4: verb signal before, up to 2 adverbs away.
  let verbIndex = first - 1;
  let adverbs = 0;
  while (verbIndex >= 0) {
    const word = lower(tags[verbIndex]);
    if (word !== undefined && VERB_BEFORE.has(word)) {
      return "verb";
    }
    if (tags[verbIndex]?.pos !== "adverb" || adverbs >= MAX_ADVERBS_BEFORE) {
      break;
    }
    verbIndex -= 1;
    adverbs += 1;
  }

  // Rule 5: compound noun (closed and hyphen forms only).
  if (!isOpen && before !== undefined && NOUN_LIKE.has(before.pos)) {
    return "noun";
  }

  // Rule 6: tagger, by form. Only its surprising answers mean something.
  if (isOpen) {
    return firstToken.pos === "verb" ? "verb" : undefined;
  }
  if (!hasHyphen) {
    return firstToken.pos === "noun" ? "noun" : undefined;
  }
  if (firstToken.pos === "verb") {
    return "verb";
  }
  return firstToken.pos === "noun" ? "noun" : undefined;
}
