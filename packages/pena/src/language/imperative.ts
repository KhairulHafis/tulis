import type { TaggedToken } from "./tag-tokens.js";

/** The sentence's first token when it is an imperative verb, else undefined. */
export function findImperativeStart(
  tokens: readonly TaggedToken[],
): TaggedToken | undefined {
  const first = tokens[0];
  if (
    first !== undefined &&
    first.kind === "word" &&
    first.pos === "verb" &&
    first.verbForm === "base"
  ) {
    return first;
  }
  return undefined;
}
