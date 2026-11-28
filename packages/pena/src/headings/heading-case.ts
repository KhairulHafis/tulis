import type { Token } from "../language/tokens.js";

export type HeadingCase = "sentence" | "title";

/**
 * Title-case styles leave these words lowercase, so they say nothing about
 * the heading's case. Compared in lowercase.
 */
export const MINOR_WORDS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "the",
  "and",
  "but",
  "or",
  "nor",
  "for",
  "so",
  "yet",
  "as",
  "at",
  "by",
  "from",
  "in",
  "into",
  "of",
  "off",
  "on",
  "onto",
  "out",
  "over",
  "per",
  "to",
  "up",
  "via",
  "with",
  "vs",
  "versus",
]);

/** Punctuation after which a new phrase starts. */
const START_PUNCTUATION: ReadonlySet<string> = new Set([
  ":",
  ".",
  "?",
  "!",
  "(",
  "-",
  "–",
  "—",
]);

type LetterCase = "upper" | "lower" | "none";

function caseOf(char: string): LetterCase {
  const lower = char.toLowerCase();
  const upper = char.toUpperCase();
  if (lower === upper) return "none";
  return char === upper ? "upper" : "lower";
}

function hasUpper(text: string): boolean {
  for (const char of text) {
    if (caseOf(char) === "upper") return true;
  }
  return false;
}

/** The case of the word's first letter, or undefined when it is not countable. */
function countableCase(text: string): "upper" | "lower" | undefined {
  const chars = Array.from(text);
  if (chars.length <= 1) return undefined;
  for (const char of chars) {
    if (/\p{N}/u.test(char) || char === "." || char === "_") return undefined;
  }
  for (const part of text.split("-")) {
    const partChars = Array.from(part);
    if (hasUpper(partChars.slice(1).join(""))) return undefined;
  }
  const first = caseOf(chars[0] ?? "");
  if (first === "none") return undefined;
  if (MINOR_WORDS.has(text.toLowerCase())) return undefined;
  return first;
}

/**
 * The key a word has in a set of proper nouns: NFC-normalised, lowercase,
 * with one trailing 's or right-quote 's removed.
 */
export function properNounKey(word: string): string {
  const lower = word.normalize("NFC").toLowerCase();
  if (lower.endsWith("'s") || lower.endsWith("\u2019s")) {
    return lower.slice(0, -2);
  }
  return lower;
}

export interface CountableWord {
  readonly text: string;
  readonly letterCase: "upper" | "lower";
  /** The first word, or the first after a phrase separator. */
  readonly atStart: boolean;
}

/** The countable words of a token list, in order, with their start flag. */
export function* countableWords(
  tokens: readonly Token[],
): Generator<CountableWord> {
  let atStart = true;
  for (const token of tokens) {
    if (token.kind === "punctuation") {
      if (START_PUNCTUATION.has(token.text)) atStart = true;
      continue;
    }
    if (token.kind !== "word") continue;
    const wasStart = atStart;
    atStart = false;
    const letterCase = countableCase(token.text);
    if (letterCase === undefined) continue;
    yield { text: token.text, letterCase, atStart: wasStart };
  }
}

/**
 * undefined when the heading has too few countable words to tell. A
 * capitalised word in `properNouns` (keys from `properNounKey`) is counted
 * but never decides.
 */
export function headingCase(
  tokens: readonly Token[],
  properNouns?: ReadonlySet<string>,
): HeadingCase | undefined {
  let countable = 0;
  let upperDeciding = false;
  let lowerDeciding = false;
  for (const word of countableWords(tokens)) {
    countable += 1;
    if (word.atStart) continue;
    if (word.letterCase === "lower") lowerDeciding = true;
    else if (properNouns?.has(properNounKey(word.text)) !== true) {
      upperDeciding = true;
    }
  }
  if (countable < 2) return undefined;
  if (lowerDeciding) return "sentence";
  return upperDeciding ? "title" : undefined;
}
