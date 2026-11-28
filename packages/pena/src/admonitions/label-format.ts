export type AdmonitionLabelFormat =
  "title-case-colon" | "upper-case-colon" | "title-case";

/** Words a bold label may use (compared ignoring ASCII case). */
export const LABEL_WORDS: readonly string[] = [
  "note",
  "tip",
  "important",
  "warning",
  "caution",
  "info",
  "danger",
];

/** True when `word` is a label word, ignoring ASCII case. */
export function isLabelWord(word: string): boolean {
  return LABEL_WORDS.includes(word.toLowerCase());
}

function isTitleCase(word: string): boolean {
  const first = word.slice(0, 1);
  const rest = word.slice(1);
  return (
    first !== "" &&
    first === first.toUpperCase() &&
    first !== first.toLowerCase() &&
    rest === rest.toLowerCase()
  );
}

/**
 * The label format of a label word: `Note:` and `Note` (colon after the
 * strong) are title case, `NOTE:` is upper case. Anything else has no format.
 * A one-letter word reads as title case.
 */
export function labelFormat(
  word: string,
  hasColon: boolean,
): AdmonitionLabelFormat | undefined {
  if (isTitleCase(word)) {
    return hasColon ? "title-case-colon" : "title-case";
  }
  if (hasColon && word === word.toUpperCase() && word !== word.toLowerCase()) {
    return "upper-case-colon";
  }
  return undefined;
}
