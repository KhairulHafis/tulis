import type { Heading, Text } from "mdast";

/** Longest brace group, in characters, that counts as a heading ID. */
export const MAX_HEADING_ID_LENGTH = 200;

/** A heading ID in the source: its text node and the source range to drop. */
export interface HeadingIdCut {
  readonly node: Text;
  /** Source offsets, end exclusive; starts at the whitespace before the `{`. */
  readonly start: number;
  readonly end: number;
}

function isSpace(char: string): boolean {
  return char.trim() === "";
}

function isIdStart(char: string): boolean {
  return (
    (char >= "a" && char <= "z") ||
    (char >= "A" && char <= "Z") ||
    (char >= "0" && char <= "9") ||
    char === "_" ||
    char === "-"
  );
}

/**
 * Finds a Hugo or kramdown heading ID such as `{#set-up}` or `{#id .class}`
 * at the end of a heading. Plain scans from the end, no regular expression.
 */
export function findHeadingId(
  heading: Heading,
  source: string,
): HeadingIdCut | undefined {
  const last = heading.children[heading.children.length - 1];
  const headingStart = heading.position?.start.offset;
  const headingEnd = heading.position?.end.offset;
  const textStart = last?.position?.start.offset;
  const textEnd = last?.position?.end.offset;
  if (
    last?.type !== "text" ||
    headingStart === undefined ||
    headingEnd === undefined ||
    textStart === undefined ||
    textEnd === undefined
  ) {
    return undefined;
  }
  let end = headingEnd;
  while (end > headingStart && isSpace(source.charAt(end - 1))) {
    end -= 1;
  }
  if (source.charAt(end - 1) !== "}" || end > textEnd) {
    return undefined;
  }
  const open = source.lastIndexOf("{", end - 1);
  if (
    open < textStart ||
    end - open > MAX_HEADING_ID_LENGTH ||
    source.charAt(open + 1) !== "#" ||
    !isIdStart(source.charAt(open + 2))
  ) {
    return undefined;
  }
  for (let i = open + 1; i < end - 1; i += 1) {
    const char = source.charAt(i);
    if (char === "}" || char === "\n" || char === "\r") {
      return undefined;
    }
  }
  let start = open;
  while (start > textStart && isSpace(source.charAt(start - 1))) {
    start -= 1;
  }
  return { node: last, start, end };
}
