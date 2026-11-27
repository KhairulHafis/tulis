import type { TaggedToken } from "../language/tag-tokens.js";
import type { Token } from "../language/tokens.js";

export type PurposePosition = "start" | "end";

export interface PurposeClause {
  readonly position: PurposePosition;
  /** Index of the clause's first and last token in the tags array (inclusive). */
  readonly first: number;
  readonly last: number;
}

const LEAD_ADVERBS: ReadonlySet<string> = new Set([
  "first",
  "then",
  "also",
  "now",
  "always",
  "never",
  "just",
  "simply",
]);

const NOT_INSTRUCTIONS: ReadonlySet<string> = new Set([
  "let's",
  "note",
  "have",
  "project",
  "network",
]);

/** "To date, ..." is not a purpose clause. */
const START_IDIOMS: ReadonlySet<string> = new Set(["date"]);

/** Verbs whose "to" clause is a complement, not a purpose. */
const COMPLEMENT_VERBS: ReadonlySet<string> = new Set([
  "allow",
  "enable",
  "configure",
  "set",
  "tell",
  "ask",
  "force",
  "require",
  "let",
  "permit",
  "cause",
  "expect",
  "instruct",
  "help",
  "invite",
  "prompt",
  "remind",
  "teach",
  "want",
  "need",
  "get",
  "encourage",
  "change",
  "reconfigure",
  "point",
  "schedule",
]);

/** A word that starts another clause: the scan for an end clause stops. */
const CLAUSE_MARKERS: ReadonlySet<string> = new Set([
  "that",
  "which",
  "who",
  "whom",
  "whose",
  "where",
  "when",
  "while",
  "if",
  "because",
  "unless",
  "until",
  "whether",
  "so",
  "for",
]);

const WH_WORDS: ReadonlySet<string> = new Set([
  "how",
  "what",
  "where",
  "when",
  "which",
  "whether",
  "who",
]);

/** Nouns that take an infinitive ("the ability to read"), not a purpose. */
const INFINITIVE_NOUNS: ReadonlySet<string> = new Set([
  "ability",
  "permission",
  "permissions",
  "option",
  "options",
  "way",
  "ways",
  "attempt",
  "chance",
  "decision",
  "effort",
  "right",
  "rights",
  "reason",
  "plan",
  "intention",
  "tendency",
  "failure",
  "access",
]);

/** Verbs that pick a thing ("Select the stream to expand"): a relative infinitive follows. */
const CHOOSE_VERBS: ReadonlySet<string> = new Set([
  "select",
  "choose",
  "specify",
  "find",
  "pick",
  "identify",
]);

/** Words a sentence cannot start with if it is an instruction. */
const CANNOT_START: ReadonlySet<string> = new Set([
  "the",
  "a",
  "an",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "if",
  "when",
  "for",
  "by",
  "on",
  "at",
  "with",
  "from",
  "as",
  "after",
  "before",
  "all",
  "each",
  "some",
  "many",
  "most",
  "we",
  "they",
  "he",
  "she",
  "there",
  "here",
  "our",
  "your",
  "their",
  "my",
  "his",
  "her",
  "of",
  "or",
  "and",
  "but",
  "because",
  "while",
  "is",
  "are",
  "was",
  "were",
  "can",
  "will",
  "should",
  "must",
  "may",
  "might",
  "does",
  "how",
  "what",
  "where",
  "which",
  "who",
  "why",
  "only",
  "however",
  "otherwise",
  "instead",
  "although",
  "since",
  "unless",
  "until",
  "once",
  "both",
  "either",
  "neither",
  "every",
  "any",
  "no",
  "not",
  "one",
  "other",
  "such",
  "so",
]);

const END_PUNCTUATION: ReadonlySet<string> = new Set([".", ":", "!", "?"]);

function lower(tags: readonly TaggedToken[], index: number): string {
  return tags[index]?.text.toLowerCase() ?? "";
}

function isWord(tags: readonly TaggedToken[], index: number): boolean {
  return tags[index]?.kind === "word";
}

function isBaseVerb(tags: readonly TaggedToken[], index: number): boolean {
  const token = tags[index];
  return (
    token?.pos === "verb" &&
    (token.verbForm === "base" || token.verbForm === undefined)
  );
}

function isModal(tags: readonly TaggedToken[], index: number): boolean {
  const token = tags[index];
  return token?.pos === "verb" && token.verbForm === undefined;
}

/**
 * Index of the main verb of an instruction starting at `index`, or undefined.
 * An imperative ("Run ...", "Do not run ...") or a "you" clause.
 */
function instructionMainVerb(
  tags: readonly TaggedToken[],
  index: number,
): number | undefined {
  if (CANNOT_START.has(lower(tags, index))) {
    return undefined;
  }
  if (lower(tags, index) === "you" && isWord(tags, index)) {
    let i = index + 1;
    if (isModal(tags, i)) {
      i += 1;
    }
    if (isWord(tags, i) && LEAD_ADVERBS.has(lower(tags, i))) {
      i += 1;
    }
    return tags[i]?.pos === "verb" ? i : undefined;
  }
  let i = index;
  if (isWord(tags, i) && LEAD_ADVERBS.has(lower(tags, i))) {
    i += 1;
  }
  if (lower(tags, i) === "do" && lower(tags, i + 1) === "not") {
    i += 2;
  } else if (lower(tags, i) === "don't") {
    i += 1;
  }
  if (isBaseVerb(tags, i) && !NOT_INSTRUCTIONS.has(lower(tags, i))) {
    return i;
  }
  return undefined;
}

function findStartClause(
  tags: readonly TaggedToken[],
): PurposeClause | undefined {
  let t: number;
  if (lower(tags, 0) === "to") {
    t = 0;
  } else if (
    lower(tags, 0) === "in" &&
    lower(tags, 1) === "order" &&
    lower(tags, 2) === "to"
  ) {
    t = 2;
  } else {
    return undefined;
  }
  const verb = tags[t + 1];
  if (
    verb === undefined ||
    verb.kind !== "word" ||
    verb.pos === "determiner" ||
    verb.pos === "pronoun" ||
    verb.pos === "preposition" ||
    verb.pos === "number" ||
    START_IDIOMS.has(verb.text.toLowerCase())
  ) {
    return undefined;
  }
  for (let comma = t + 2; comma < tags.length; comma++) {
    if (
      tags[comma]?.text === "," &&
      instructionMainVerb(tags, comma + 1) !== undefined
    ) {
      return { position: "start", first: 0, last: comma - 1 };
    }
  }
  return undefined;
}

/**
 * "Select the stream to expand.": after a choosing verb, a noun then `to` + one
 * verb + at most one preposition is a relative infinitive. Looks at a bounded
 * number of tokens.
 */
function isRelativeInfinitive(
  tags: readonly TaggedToken[],
  to: number,
  end: number,
): boolean {
  const before = tags[to - 1];
  if (
    before?.kind !== "word" ||
    (before.pos !== "noun" && before.pos !== "properNoun")
  ) {
    return false;
  }
  const length = end - to;
  // The tagger reads the trailing "to" of "upgrade to" as a conjunction, so a
  // plain "to" counts as a preposition here.
  const last = tags[to + 2];
  return (
    length === 2 ||
    (length === 3 &&
      (last?.pos === "preposition" || lower(tags, to + 2) === "to"))
  );
}

function findEndClause(
  tags: readonly TaggedToken[],
): PurposeClause | undefined {
  const main = instructionMainVerb(tags, 0);
  if (main === undefined || COMPLEMENT_VERBS.has(lower(tags, main))) {
    return undefined;
  }
  // "Type of integration to create." is a noun phrase, not an instruction.
  if (lower(tags, main + 1) === "of") {
    return undefined;
  }
  const mainIsChoosing = CHOOSE_VERBS.has(lower(tags, main));
  let end = tags.length;
  while (end > 0 && END_PUNCTUATION.has(lower(tags, end - 1))) {
    end -= 1;
  }
  for (let i = main + 1; i < end; i++) {
    const token = tags[i];
    if (token === undefined) {
      break;
    }
    const text = token.text.toLowerCase();
    if (text === "to" && isBaseVerb(tags, i + 1) && i + 1 < end) {
      if (lower(tags, i - 2) === "in" && lower(tags, i - 1) === "order") {
        return { position: "end", first: i - 2, last: end - 1 };
      }
      const before = tags[i - 1];
      const beforeText = lower(tags, i - 1);
      if (
        before === undefined ||
        before.pos === "verb" ||
        before.pos === "adjective" ||
        before.pos === "adverb" ||
        WH_WORDS.has(beforeText) ||
        INFINITIVE_NOUNS.has(beforeText)
      ) {
        return undefined;
      }
      // Passive infinitive: "List the files to be scanned."
      if (lower(tags, i + 1) === "be") {
        return undefined;
      }
      if (mainIsChoosing && isRelativeInfinitive(tags, i, end)) {
        return undefined;
      }
      return { position: "end", first: i, last: end - 1 };
    }
    if (token.kind === "word" && CLAUSE_MARKERS.has(text)) {
      return undefined;
    }
    if (
      token.pos === "verb" &&
      (token.verbForm === "present" ||
        token.verbForm === "past" ||
        token.verbForm === undefined)
    ) {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Finds the sentence's purpose clause, at the start ("To X, do Y.") or the end
 * ("Do Y to X."). Records nothing when no rule is sure. Each rule is a single
 * forward pass over the tokens.
 */
export function findPurposeClause(
  tags: readonly TaggedToken[],
): PurposeClause | undefined {
  return findStartClause(tags) ?? findEndClause(tags);
}

/**
 * A cheap check before tagging, which is the costly step: a purpose clause
 * needs a word "to", and the rules reject any sentence that starts with a word
 * in CANNOT_START or with a non-word, so tagging those sentences is wasted.
 */
export function mayHavePurposeClause(tokens: readonly Token[]): boolean {
  const first = tokens[0];
  if (first?.kind !== "word" || CANNOT_START.has(first.text.toLowerCase())) {
    return false;
  }
  return tokens.some(
    (token) => token.kind === "word" && token.text.toLowerCase() === "to",
  );
}
