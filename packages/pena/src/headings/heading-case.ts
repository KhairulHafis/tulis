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

/** undefined when the heading has too few countable words to tell. */
export function headingCase(tokens: readonly Token[]): HeadingCase | undefined {
  let atStart = true;
  let countable = 0;
  let upperDeciding = false;
  let lowerDeciding = false;
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
    countable += 1;
    if (wasStart) continue;
    if (letterCase === "lower") lowerDeciding = true;
    else upperDeciding = true;
  }
  if (countable < 2) return undefined;
  if (lowerDeciding) return "sentence";
  return upperDeciding ? "title" : undefined;
}
