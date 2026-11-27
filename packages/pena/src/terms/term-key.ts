/** Whitespace, hyphens (U+002D, U+2010, U+2011) and soft hyphens (U+00AD). */
const REMOVED = /[\s\-\u2010\u2011\u00AD]+/gu;

/**
 * Spelling key: NFC, lower case (String.prototype.toLowerCase, never a
 * locale), with whitespace, hyphens (U+002D, U+2010, U+2011) and soft hyphens
 * (U+00AD) removed. "Log-In", "log in" and "login" all give "login".
 */
export function termKey(text: string): string {
  return text.normalize("NFC").toLowerCase().replace(REMOVED, "");
}
