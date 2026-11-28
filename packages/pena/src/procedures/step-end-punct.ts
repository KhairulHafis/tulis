import type { Token } from "../language/tokens.js";

export type StepEndPunct = "period" | "none";

const RIGHT_DOUBLE_QUOTE = String.fromCodePoint(0x201d);
const RIGHT_SINGLE_QUOTE = String.fromCodePoint(0x2019);
const CLOSING = new Set([
  ")",
  "]",
  '"',
  "'",
  RIGHT_DOUBLE_QUOTE,
  RIGHT_SINGLE_QUOTE,
]);

/**
 * How a step's last sentence ends. Trailing closing marks are ignored.
 * Ellipses, colons, question marks and so on give undefined.
 */
export function stepEndPunct(
  tokens: readonly Token[],
): StepEndPunct | undefined {
  let end = tokens.length;
  while (end > 0) {
    const token = tokens[end - 1];
    if (token?.kind === "punctuation" && CLOSING.has(token.text)) {
      end -= 1;
    } else {
      break;
    }
  }
  const last = tokens[end - 1];
  if (last === undefined) {
    return undefined;
  }
  if (last.kind === "punctuation" && last.text === ".") {
    const before = tokens[end - 2];
    return before?.kind === "punctuation" && before.text === "."
      ? undefined
      : "period";
  }
  if (
    last.kind === "word" ||
    last.kind === "number" ||
    last.kind === "placeholder"
  ) {
    return "none";
  }
  return undefined;
}
