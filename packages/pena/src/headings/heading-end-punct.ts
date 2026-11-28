import type { Token } from "../language/tokens.js";

export type HeadingEndPunct = "none" | "period" | "colon";

/** undefined for no tokens, or an ending that is none of the three (?, !, ellipsis, ; and ,). */
export function headingEndPunct(
  tokens: readonly Token[],
): HeadingEndPunct | undefined {
  const last = tokens[tokens.length - 1];
  if (last === undefined) return undefined;
  if (last.kind === "punctuation") {
    if (last.text === ":") return "colon";
    if (last.text === ".") {
      const before = tokens[tokens.length - 2];
      const ellipsis =
        before?.text === "." && before.maskedEnd === last.maskedStart;
      return ellipsis ? undefined : "period";
    }
    if (["…", "?", "!", ";", ","].includes(last.text)) return undefined;
  }
  return "none";
}
