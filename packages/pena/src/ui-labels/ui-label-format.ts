import type { Token } from "../language/tokens.js";

export type UiLabelFormat =
  "bold" | "quotes" | "code" | "plain" | "hugo-shortcode";

export interface UiLabel {
  readonly format: UiLabelFormat;
  /** Source offsets, end exclusive. */
  readonly start: number;
  readonly end: number;
}

/** Lowercase verbs after which a UI label is expected. */
export const UI_LABEL_VERBS: ReadonlySet<string> = new Set([
  "click",
  "double-click",
  "right-click",
  "select",
  "choose",
  "tap",
  "expand",
  "clear",
]);

/** Words skipped between the verb and the object (not for plain labels). */
const SKIPPED_WORDS: ReadonlySet<string> = new Set(["the", "on"]);
const MAX_SKIPPED = 2;
/** How far the closing quote may be from the opening quote, in tokens. */
const MAX_QUOTE_TOKENS = 12;
/** A plain label must end the sentence within this many tokens of the verb. */
const MAX_PLAIN_SPAN = 8;
const MAX_LETTER_SCAN = 200;
const MAX_SHORTCODE_SCAN = 20;

const CLOSING_QUOTES: ReadonlyMap<string, string> = new Map([
  ['"', '"'],
  ["“", "”"],
  ["'", "'"],
  ["‘", "’"],
]);

const LETTER = /\p{L}/u;
const UPPERCASE = /\p{Lu}/u;
const WHITESPACE = /\s/u;
const HUGO_UI = /^\{\{[<%][ \t]*ui[ \t]/u;

/** True when the first letter in the first 200 characters is uppercase. */
function startsUppercase(text: string): boolean {
  for (const char of text.slice(0, MAX_LETTER_SCAN)) {
    if (LETTER.test(char)) {
      return UPPERCASE.test(char);
    }
  }
  return false;
}

function isBlank(source: string, from: number, to: number): boolean {
  if (from > to) {
    return false;
  }
  for (let i = from; i < to; i++) {
    if (!WHITESPACE.test(source.charAt(i))) {
      return false;
    }
  }
  return true;
}

function sourcePrefix(token: Token, source: string, limit: number): string {
  return source.slice(
    token.source.start,
    Math.min(token.source.end, token.source.start + limit),
  );
}

/** Long bold: `**` or `__` right before the word, only blanks before that. */
function hasBoldBefore(token: Token, previous: Token, source: string): boolean {
  const start = token.source.start;
  const marker = source.slice(start - 2, start);
  return (
    (marker === "**" || marker === "__") &&
    isBlank(source, previous.source.end, start - 2)
  );
}

function placeholderLabel(
  object: Token,
  source: string,
): UiLabelFormat | undefined {
  if (object.placeholder === "UI") {
    return startsUppercase(sourcePrefix(object, source, MAX_LETTER_SCAN))
      ? "bold"
      : undefined;
  }
  if (object.placeholder === "CODE") {
    return startsUppercase(sourcePrefix(object, source, MAX_LETTER_SCAN))
      ? "code"
      : undefined;
  }
  if (object.placeholder === "SHORTCODE") {
    return HUGO_UI.test(sourcePrefix(object, source, MAX_SHORTCODE_SCAN))
      ? "hugo-shortcode"
      : undefined;
  }
  return undefined;
}

/** The end offset of a quoted label that opens at `open`, if there is one. */
function quotedEnd(tokens: readonly Token[], open: number): number | undefined {
  const opening = tokens[open];
  const word = tokens[open + 1];
  if (opening === undefined || word === undefined) {
    return undefined;
  }
  const closing = CLOSING_QUOTES.get(opening.text);
  if (
    opening.kind !== "punctuation" ||
    closing === undefined ||
    word.kind !== "word" ||
    !startsUppercase(word.text)
  ) {
    return undefined;
  }
  const last = Math.min(tokens.length - 1, open + MAX_QUOTE_TOKENS);
  for (let i = open + 2; i <= last; i++) {
    const token = tokens[i];
    if (token?.kind === "punctuation" && token.text === closing) {
      return token.source.end;
    }
  }
  return undefined;
}

function plainEnd(
  tokens: readonly Token[],
  verb: number,
  source: string,
): number | undefined {
  const verbToken = tokens[verb];
  const object = tokens[verb + 1];
  const lastIndex = tokens.length - 1;
  if (verbToken === undefined || object === undefined) {
    return undefined;
  }
  const afterVerb = verb === 0 || tokens[verb - 1]?.text === ",";
  if (
    object.kind !== "word" ||
    !startsUppercase(object.text) ||
    !afterVerb ||
    tokens[lastIndex]?.text !== "." ||
    lastIndex > verb + MAX_PLAIN_SPAN ||
    !isBlank(source, verbToken.source.end, object.source.start)
  ) {
    return undefined;
  }
  return object.source.end;
}

/** The label that follows the verb at `verb`, if the rules decide. */
function labelAfter(
  tokens: readonly Token[],
  verb: number,
  source: string,
): UiLabel | undefined {
  const verbToken = tokens[verb];
  if (verbToken === undefined) {
    return undefined;
  }
  const start = verbToken.source.start;
  let index = verb + 1;
  let skipped = 0;
  while (skipped < MAX_SKIPPED) {
    const token = tokens[index];
    if (token?.kind === "word" && SKIPPED_WORDS.has(token.text.toLowerCase())) {
      index++;
      skipped++;
    } else {
      break;
    }
  }
  const object = tokens[index];
  const previous = tokens[index - 1];
  if (object === undefined || previous === undefined) {
    return undefined;
  }

  if (object.kind === "placeholder") {
    const format = placeholderLabel(object, source);
    return format === undefined
      ? undefined
      : { format, start, end: object.source.end };
  }
  if (object.kind === "word") {
    if (hasBoldBefore(object, previous, source)) {
      return startsUppercase(object.text)
        ? { format: "bold", start, end: object.source.end }
        : undefined;
    }
    if (skipped === 0) {
      const end = plainEnd(tokens, verb, source);
      return end === undefined ? undefined : { format: "plain", start, end };
    }
    return undefined;
  }
  if (object.kind === "punctuation") {
    const end = quotedEnd(tokens, index);
    return end === undefined ? undefined : { format: "quotes", start, end };
  }
  return undefined;
}

/**
 * How UI labels are written after verbs like "select" in one sentence. At most
 * one label per verb; when the rules do not decide, nothing is recorded. Work
 * per verb is bounded, so the scan is linear in the number of tokens.
 */
export function findUiLabels(
  tokens: readonly Token[],
  source: string,
): readonly UiLabel[] {
  const labels: UiLabel[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (
      token?.kind === "word" &&
      UI_LABEL_VERBS.has(token.text.toLowerCase())
    ) {
      const label = labelAfter(tokens, i, source);
      if (label !== undefined) {
        labels.push(label);
      }
    }
  }
  return labels;
}
