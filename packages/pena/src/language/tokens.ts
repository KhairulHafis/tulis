import type { SourceRange } from "../markdown/ignored-ranges.js";
import {
  toSourceRange,
  type MaskedText,
  type Placeholder,
  type PlaceholderKind,
} from "../markdown/masked-text.js";
import type { Sentence } from "../markdown/sentences.js";

export type TokenKind =
  "word" | "number" | "placeholder" | "punctuation" | "symbol";

export interface Token {
  /** Exactly masked.text.slice(maskedStart, maskedEnd). */
  readonly text: string;
  readonly kind: TokenKind;
  /** Set only when kind is "placeholder". */
  readonly placeholder: PlaceholderKind | undefined;
  readonly maskedStart: number;
  readonly maskedEnd: number;
  /** toSourceRange(masked, maskedStart, maskedEnd) */
  readonly source: SourceRange;
}

const SPACE = /\s/u;
const WORD_CHAR = /[\p{L}\p{M}\p{N}]/u;
const LETTER = /\p{L}/u;
const PUNCTUATION = /\p{P}/u;

/** Hyphen, apostrophe, right single quote, full stop, underscore. */
const JOINERS: ReadonlySet<string> = new Set(["-", "'", "’", ".", "_"]);

/** The code point that starts at `index`, as a string (a lone surrogate stays alone). */
function charAt(text: string, index: number): string {
  const code = text.codePointAt(index);
  return code === undefined ? "" : String.fromCodePoint(code);
}

function isWordChar(char: string): boolean {
  return char !== "" && WORD_CHAR.test(char);
}

/**
 * The end of the word or number that starts at `start`. A joiner counts only
 * when a word character follows it, so `end.` stops before the dot and
 * `rock--solid` stops before the first hyphen. Never reads past `limit`.
 */
function wordEnd(text: string, start: number, limit: number): number {
  let i = start;
  while (i < limit) {
    const char = charAt(text, i);
    if (isWordChar(char)) {
      i += char.length;
      continue;
    }
    // Joiners are single code units, so the next character starts at i + 1.
    if (JOINERS.has(char) && i + 1 < limit) {
      const next = charAt(text, i + 1);
      // A character that would cross `limit` is a surrogate pair cut short.
      if (i + 1 + next.length <= limit && isWordChar(next)) {
        i += 1 + next.length;
        continue;
      }
    }
    break;
  }
  return i;
}

function validate(masked: MaskedText, sentence: Sentence): void {
  const { maskedStart, maskedEnd } = sentence;
  if (
    !Number.isInteger(maskedStart) ||
    !Number.isInteger(maskedEnd) ||
    maskedStart < 0 ||
    maskedEnd < maskedStart ||
    maskedEnd > masked.text.length
  ) {
    throw new RangeError("The sentence is outside the masked text.");
  }
  if (masked.text.slice(maskedStart, maskedEnd) !== sentence.text) {
    throw new RangeError("The sentence text does not match the masked text.");
  }
}

/**
 * Splits one sentence into tokens in a single pass. Placeholders are taken
 * from `masked.placeholders` (never by looking for braces in the text), so a
 * `{CODE}` the writer typed is ordinary text.
 */
export function tokenizeSentence(
  masked: MaskedText,
  sentence: Sentence,
): Token[] {
  validate(masked, sentence);
  const base = sentence.maskedStart;
  const text = sentence.text;
  const tokens: Token[] = [];

  const placeholders = masked.placeholders;
  // Index of the first placeholder not yet passed. Placeholders are in order.
  let next = 0;

  const add = (
    start: number,
    end: number,
    kind: TokenKind,
    placeholder: PlaceholderKind | undefined,
  ): void => {
    tokens.push({
      text: text.slice(start, end),
      kind,
      placeholder,
      maskedStart: base + start,
      maskedEnd: base + end,
      source: toSourceRange(masked, base + start, base + end),
    });
  };

  /** The next placeholder that starts at or after `from` and fits the sentence. */
  const upcoming = (from: number): Placeholder | undefined => {
    while (next < placeholders.length) {
      const candidate = placeholders[next];
      if (candidate === undefined) {
        return undefined;
      }
      if (candidate.maskedStart - base < from) {
        next++;
        continue;
      }
      const fits =
        candidate.maskedEnd > candidate.maskedStart &&
        candidate.maskedEnd <= sentence.maskedEnd;
      return fits ? candidate : undefined;
    }
    return undefined;
  };

  let i = 0;
  while (i < text.length) {
    const char = charAt(text, i);
    if (SPACE.test(char)) {
      i += char.length;
      continue;
    }

    const placeholder = upcoming(i);
    const placeholderStart =
      placeholder === undefined ? text.length : placeholder.maskedStart - base;

    if (placeholder !== undefined && placeholderStart === i) {
      const end = placeholder.maskedEnd - base;
      add(i, end, "placeholder", placeholder.kind);
      i = end;
      continue;
    }

    if (isWordChar(char)) {
      const end = wordEnd(text, i, placeholderStart);
      const kind = LETTER.test(text.slice(i, end)) ? "word" : "number";
      add(i, end, kind, undefined);
      i = end;
      continue;
    }

    const kind = PUNCTUATION.test(char) ? "punctuation" : "symbol";
    add(i, i + char.length, kind, undefined);
    i += char.length;
  }
  return tokens;
}
