import { findImperativeStart } from "../language/imperative.js";
import { tagSentence, type TaggedToken } from "../language/tag-tokens.js";
import type { Token } from "../language/tokens.js";

export type StepStart = "imperative" | "other";

/** Most counting tokens allowed before the comma that ends a lead-in. */
export const MAX_LEAD_IN_WORDS = 12;

/** Most tokens after a comma that are tagged again. */
const RETAG_WINDOW = 32;

/** Most commas tried as the end of a lead-in. */
const MAX_COMMAS_TRIED = 3;

function isCounting(token: Token): boolean {
  return (
    token.kind === "word" ||
    token.kind === "number" ||
    token.kind === "placeholder"
  );
}

/** True when the tokens from `from` on, tagged as their own sentence, start with an imperative verb. */
function startsImperative(tokens: readonly Token[], from: number): boolean {
  const window = tokens.slice(from, from + RETAG_WINDOW);
  if (window.length === 0) {
    return false;
  }
  return findImperativeStart(tagSentence(window)) !== undefined;
}

function isLabel(tokens: readonly Token[]): boolean {
  return tokens[0]?.kind === "word" && isPunctuation(tokens[1], ":");
}

function isPunctuation(token: Token | undefined, text: string): boolean {
  return token?.kind === "punctuation" && token.text === text;
}

/** True when a short lead-in ends at one of the first few commas. */
function hasLeadIn(tokens: readonly Token[]): boolean {
  let counted = 0;
  let tried = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === undefined) {
      break;
    }
    if (isCounting(token)) {
      counted += 1;
      if (counted > MAX_LEAD_IN_WORDS) {
        return false;
      }
    } else if (
      isPunctuation(token, ",") &&
      counted >= 1 &&
      tokens[i + 1]?.kind === "word"
    ) {
      tried += 1;
      if (startsImperative(tokens, i + 1)) {
        return true;
      }
      if (tried >= MAX_COMMAS_TRIED) {
        return false;
      }
    }
  }
  return false;
}

/**
 * Whether a procedure step starts with an imperative verb, allowing a label
 * ("Optional: Select ...") or a short lead-in ("In the sidebar, select ...").
 * Undefined when the sentence has no word, number or placeholder.
 * `tags` is one TaggedToken per token, in the same order.
 */
export function stepStart(
  tokens: readonly Token[],
  tags: readonly TaggedToken[],
): StepStart | undefined {
  if (!tokens.some(isCounting)) {
    return undefined;
  }
  if (findImperativeStart(tags) !== undefined) {
    return "imperative";
  }
  if (isLabel(tokens)) {
    return startsImperative(tokens, 2) ? "imperative" : "other";
  }
  return hasLeadIn(tokens) ? "imperative" : "other";
}
