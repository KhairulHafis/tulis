import type { PreparedBlock } from "../prepare/prepare-doc.js";

export type ProcedureIntro = "colon" | "heading";

/** What leads into a procedure: a heading, or a paragraph ending in a colon. */
export function procedureIntro(
  before: PreparedBlock | undefined,
): ProcedureIntro | undefined {
  if (before === undefined) {
    return undefined;
  }
  if (before.kind === "heading") {
    return "heading";
  }
  if (before.kind === "paragraph") {
    const last = before.sentences[before.sentences.length - 1];
    const token = last?.tokens[last.tokens.length - 1];
    if (token?.kind === "punctuation" && token.text === ":") {
      return "colon";
    }
  }
  return undefined;
}
