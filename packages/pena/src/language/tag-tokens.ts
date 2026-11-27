import nlp from "compromise/two";
import type { Token } from "./tokens.js";

export type PartOfSpeech =
  | "verb"
  | "noun"
  | "properNoun"
  | "pronoun"
  | "adjective"
  | "adverb"
  | "determiner"
  | "preposition"
  | "conjunction"
  | "number"
  | "placeholder"
  | "punctuation"
  | "symbol"
  | "other";

/** base: install, run (infinitive or imperative). present: installs. */
export type VerbForm = "base" | "gerund" | "past" | "participle" | "present";

export interface TaggedToken extends Token {
  readonly pos: PartOfSpeech;
  /** Set only when pos is "verb"; undefined for verbs with no form (can, must). */
  readonly verbForm: VerbForm | undefined;
}

/** Words that start a step as a verb even when the tagger reads them otherwise. */
export const SENTENCE_START_VERBS: ReadonlySet<string> = new Set([
  "select",
  "open",
  "check",
  "download",
  "review",
  "parse",
  "click",
  "choose",
  "clear",
  "close",
  "copy",
  "paste",
  "enter",
  "type",
  "press",
  "tap",
  "expand",
  "collapse",
  "scroll",
  "view",
  "list",
  "run",
  "set",
  "edit",
  "save",
  "update",
  "troubleshoot",
]);

/** Words that are a noun when they are the only word of a sentence (headings). */
const SENTENCE_START_NOUNS: ReadonlySet<string> = new Set(["overview"]);

/** The most terms handed to the tagger in one call. */
const CHUNK_SIZE = 1000;

/** Longest first word we lowercase for the start corrections. */
const LONGEST_START_WORD = 32;

/** Compromise tag to part of speech, in priority order. */
const POS_TABLE: readonly (readonly [string, PartOfSpeech])[] = [
  ["Verb", "verb"],
  ["Pronoun", "pronoun"],
  ["ProperNoun", "properNoun"],
  ["Noun", "noun"],
  ["Adjective", "adjective"],
  ["Adverb", "adverb"],
  ["Determiner", "determiner"],
  ["Preposition", "preposition"],
  ["Conjunction", "conjunction"],
  ["Value", "number"],
];

/** Compromise tag to verb form, in priority order. */
const VERB_FORM_TABLE: readonly (readonly [string, VerbForm])[] = [
  ["Gerund", "gerund"],
  ["Infinitive", "base"],
  ["Imperative", "base"],
  ["Participle", "participle"],
  ["PastTense", "past"],
  ["PresentTense", "present"],
];

/** The first entry of `table` whose tag the word has. */
function lookup<T>(
  table: readonly (readonly [string, T])[],
  tags: ReadonlySet<string>,
): T | undefined {
  for (const [tag, value] of table) {
    if (tags.has(tag)) {
      return value;
    }
  }
  return undefined;
}

function fromTags(tags: readonly string[]): {
  pos: PartOfSpeech;
  verbForm: VerbForm | undefined;
} {
  const set = new Set(tags);
  const pos = lookup(POS_TABLE, set) ?? "other";
  return {
    pos,
    verbForm: pos === "verb" ? lookup(VERB_FORM_TABLE, set) : undefined,
  };
}

/** One term in compromise's JSON input format. */
interface InputTerm {
  text: string;
  normal: string;
  pre: string;
  post: string;
  tags: string[];
  frozen?: boolean;
}

/** A term and the index of the token it stands for. */
interface PendingTerm {
  readonly term: InputTerm;
  readonly tokenIndex: number;
}

const PLACEHOLDER_TAGS = ["ProperNoun", "Noun", "Singular"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Runs the tagger over our own terms. Returns one tag list per input term, or
 * undefined when the answer does not line up with the input. Contractions come
 * back as two terms, the second with empty text and an `implicit` word; only
 * that one is dropped, so the first keeps the tags of the written word.
 */
function runTagger(terms: readonly InputTerm[]): string[][] | undefined {
  // compromise's types only allow a string here; it also takes JSON input.
  const view: unknown = Reflect.apply(nlp, undefined, [[{ terms }]]);
  if (!isRecord(view) || typeof view["json"] !== "function") {
    return undefined;
  }
  const json: unknown = Reflect.apply(view["json"], view, []);
  const sentence: unknown = Array.isArray(json) ? json[0] : undefined;
  if (!isRecord(sentence) || !Array.isArray(sentence["terms"])) {
    return undefined;
  }
  const items: unknown[] = sentence["terms"];
  const result: string[][] = [];
  for (const item of items) {
    if (!isRecord(item) || typeof item["text"] !== "string") {
      return undefined;
    }
    if (item["text"] === "" && typeof item["implicit"] === "string") {
      continue;
    }
    const tags: unknown = item["tags"];
    if (!Array.isArray(tags)) {
      return undefined;
    }
    const names: unknown[] = tags;
    result.push(names.filter((tag) => typeof tag === "string"));
  }
  return result.length === terms.length ? result : undefined;
}

/** Builds the tagger's terms. Punctuation and symbols go into pre and post. */
function buildTerms(tokens: readonly Token[]): PendingTerm[] {
  const terms: PendingTerm[] = [];
  let last: InputTerm | undefined;
  let leading = "";
  let previousEnd = -1;
  tokens.forEach((token, tokenIndex) => {
    const gap = previousEnd >= 0 && token.maskedStart > previousEnd ? " " : "";
    previousEnd = token.maskedEnd;
    if (token.kind === "punctuation" || token.kind === "symbol") {
      if (last === undefined) {
        leading += gap + token.text;
      } else {
        last.post += gap + token.text;
      }
      return;
    }
    if (last !== undefined) {
      last.post += gap;
    }
    const isPlaceholder = token.kind === "placeholder";
    const term: InputTerm = {
      text: token.text,
      normal: token.text.toLowerCase().replaceAll("’", "'"),
      pre: last === undefined ? leading : "",
      post: "",
      tags: isPlaceholder ? [...PLACEHOLDER_TAGS] : [],
    };
    if (isPlaceholder) {
      term.frozen = true;
    }
    terms.push({ term, tokenIndex });
    last = term;
  });
  return terms;
}

/** Tags in chunks of at most CHUNK_SIZE terms. */
function tagTerms(
  tokens: readonly Token[],
): Map<number, ReturnType<typeof fromTags>> {
  const tagged = new Map<number, ReturnType<typeof fromTags>>();
  const pending = buildTerms(tokens);
  for (let start = 0; start < pending.length; start += CHUNK_SIZE) {
    const chunk = pending.slice(start, start + CHUNK_SIZE);
    const tags = runTagger(chunk.map((item) => item.term));
    chunk.forEach((item, i) => {
      const itemTags = tags?.[i];
      tagged.set(
        item.tokenIndex,
        itemTags === undefined
          ? { pos: "other", verbForm: undefined }
          : fromTags(itemTags),
      );
    });
  }
  return tagged;
}

function fixedPos(token: Token): PartOfSpeech | undefined {
  switch (token.kind) {
    case "placeholder":
    case "punctuation":
    case "symbol":
    case "number":
      return token.kind;
    case "word":
      return undefined;
  }
}

function startWord(token: Token | undefined): string | undefined {
  if (
    token === undefined ||
    token.kind !== "word" ||
    token.text.length > LONGEST_START_WORD
  ) {
    return undefined;
  }
  return token.text.toLowerCase();
}

/** Tokens must be one whole sentence, in order. Returns one TaggedToken per token, same order. */
export function tagSentence(tokens: readonly Token[]): TaggedToken[] {
  const tagged = tagTerms(tokens);
  const result: TaggedToken[] = tokens.map((token, index) => {
    const fixed = fixedPos(token);
    if (fixed !== undefined) {
      return { ...token, pos: fixed, verbForm: undefined };
    }
    const found = tagged.get(index) ?? { pos: "other", verbForm: undefined };
    return { ...token, pos: found.pos, verbForm: found.verbForm };
  });

  const first = result[0];
  const word = startWord(first);
  if (first !== undefined && word !== undefined) {
    const second = result[1];
    if (
      SENTENCE_START_VERBS.has(word) &&
      first.pos !== "verb" &&
      second?.pos !== "noun"
    ) {
      result[0] = { ...first, pos: "verb", verbForm: "base" };
    } else if (
      SENTENCE_START_NOUNS.has(word) &&
      tokens.filter((token) => token.kind === "word").length === 1
    ) {
      result[0] = { ...first, pos: "noun", verbForm: undefined };
    }
  }
  return result;
}
