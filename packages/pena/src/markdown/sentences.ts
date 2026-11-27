import type { SourceRange } from "./ignored-ranges.js";
import { toSourceRange, type MaskedText } from "./masked-text.js";

export interface Sentence {
  /** Exactly masked.text.slice(maskedStart, maskedEnd); soft-wrap "\n" kept as is. */
  readonly text: string;
  readonly maskedStart: number;
  readonly maskedEnd: number;
  /** toSourceRange(masked, maskedStart, maskedEnd) */
  readonly source: SourceRange;
}

/** Abbreviations that never end a sentence, lowercase, without the final dot. */
export const ABBREVIATIONS: ReadonlySet<string> = new Set([
  "e.g",
  "i.e",
  "vs",
  "cf",
  "approx",
  "dr",
  "mr",
  "mrs",
  "ms",
  "prof",
  "jr",
  "sr",
  "st",
  "no",
  "nos",
  "fig",
  "figs",
  "eq",
  "vol",
  "ch",
  "sec",
  "pp",
  "ca",
  "incl",
  "esp",
  "resp",
  "al",
]);

/** How many characters before a dot the abbreviation check may read. */
const MAX_LOOK_BACK = 20;

const TERMINATORS = new Set([".", "?", "!", "\u2026"]);
const CLOSERS = new Set(['"', "'", ")", "]", "\u201D", "\u2019"]);
const OPENERS = new Set(['"', "'", "(", "[", "\u201C", "\u2018"]);

function isWhitespace(char: string): boolean {
  return /\s/u.test(char);
}

function isLetter(char: string): boolean {
  return /^\p{L}$/u.test(char);
}

function startsSentence(char: string): boolean {
  const codePoint = char.codePointAt(0);
  if (codePoint === undefined) {
    return false;
  }
  const first = String.fromCodePoint(codePoint);
  return OPENERS.has(first) || /^[\p{Lu}0-9]$/u.test(first);
}

/** Letters and dots right before `dot`, or undefined if the word is too long. */
function wordBefore(text: string, dot: number): string | undefined {
  let from = dot;
  while (from > 0 && dot - from < MAX_LOOK_BACK) {
    const char = text.charAt(from - 1);
    if (char !== "." && !isLetter(char)) {
      return text.slice(from, dot);
    }
    from--;
  }
  return from === 0 ? text.slice(0, dot) : undefined;
}

/** Letter, dot, letter, dot, ... letter (the final dot is not in `word`). */
function isDottedLetters(word: string): boolean {
  if (word.length < 3 || word.length % 2 === 0) {
    return false;
  }
  for (let k = 0; k < word.length; k++) {
    const char = word.charAt(k);
    if (k % 2 === 0 ? !isLetter(char) : char !== ".") {
      return false;
    }
  }
  return true;
}

function isInitial(word: string): boolean {
  return word.length === 1 && /^\p{Lu}$/u.test(word);
}

function isAbbreviation(text: string, dot: number): boolean {
  const word = wordBefore(text, dot);
  if (word === undefined || word.length === 0) {
    return false;
  }
  return (
    ABBREVIATIONS.has(word.toLowerCase()) ||
    isDottedLetters(word) ||
    isInitial(word)
  );
}

export function splitSentences(masked: MaskedText): Sentence[] {
  const text = masked.text;
  const length = text.length;
  const sentences: Sentence[] = [];

  const lineBreaks = new Uint8Array(length + 1);
  for (const segment of masked.segments) {
    if (
      segment.atomic &&
      segment.placeholder === undefined &&
      segment.maskedEnd - segment.maskedStart === 1 &&
      text.charAt(segment.maskedStart) === "\n"
    ) {
      lineBreaks[segment.maskedStart] = 1;
    }
  }
  // Placeholder start -> end, stored as end + 1 (0 means none).
  const placeholderEnds = new Int32Array(length + 1);
  for (const placeholder of masked.placeholders) {
    placeholderEnds[placeholder.maskedStart] = placeholder.maskedEnd + 1;
  }

  let start = -1;
  let last = -1;

  const flush = (): void => {
    if (start >= 0 && last > start) {
      sentences.push({
        text: text.slice(start, last),
        maskedStart: start,
        maskedEnd: last,
        source: toSourceRange(masked, start, last),
      });
    }
    start = -1;
    last = -1;
  };

  /** True when the text after `from` lets a sentence end there. */
  const nextStartsSentence = (from: number): boolean => {
    let p = from;
    while (p < length && lineBreaks[p] === 0 && isWhitespace(text.charAt(p))) {
      p++;
    }
    if (p >= length || lineBreaks[p] === 1 || placeholderEnds[p] !== 0) {
      return true;
    }
    return startsSentence(text.slice(p, p + 2));
  };

  let i = 0;
  while (i < length) {
    if (lineBreaks[i] === 1) {
      flush();
      i++;
      continue;
    }
    const placeholderEnd = placeholderEnds[i];
    if (placeholderEnd !== undefined && placeholderEnd !== 0) {
      if (start < 0) {
        start = i;
      }
      i = placeholderEnd - 1;
      last = i;
      continue;
    }
    const char = text.charAt(i);
    if (isWhitespace(char)) {
      i++;
      continue;
    }
    if (start < 0) {
      start = i;
    }
    if (!TERMINATORS.has(char)) {
      i++;
      last = i;
      continue;
    }
    let j = i;
    while (j < length && TERMINATORS.has(text.charAt(j))) {
      j++;
    }
    let k = j;
    while (k < length && CLOSERS.has(text.charAt(k))) {
      k++;
    }
    last = k;
    const atBoundary = k >= length || isWhitespace(text.charAt(k));
    if (atBoundary && nextStartsSentence(k)) {
      const singleDot = j - i === 1 && char === ".";
      if (!(singleDot && isAbbreviation(text, i))) {
        flush();
      }
    }
    i = k;
  }
  flush();
  return sentences;
}
