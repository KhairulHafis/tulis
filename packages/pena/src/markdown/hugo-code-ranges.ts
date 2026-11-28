import type { SourceRange } from "./ignored-ranges.js";

const NAME = "highlight";

type TagKind = "open" | "close";

function isNameChar(char: string): boolean {
  return (
    (char >= "a" && char <= "z") ||
    (char >= "A" && char <= "Z") ||
    (char >= "0" && char <= "9") ||
    char === "_" ||
    char === "-"
  );
}

/**
 * Reads a `{{< highlight ... >}}`-style tag at the start of a line (after up
 * to 3 spaces). Fixed prefix checks only: the work is bounded by a few
 * characters plus the spaces inside the delimiters, so it is linear overall.
 */
function tagKind(line: string): TagKind | undefined {
  let at = 0;
  while (at < 3 && line.charAt(at) === " ") {
    at += 1;
  }
  if (line.charAt(at) !== "{" || line.charAt(at + 1) !== "{") {
    return undefined;
  }
  const delimiter = line.charAt(at + 2);
  if (delimiter !== "<" && delimiter !== "%") {
    return undefined;
  }
  at += 3;
  while (line.charAt(at) === " " || line.charAt(at) === "\t") {
    at += 1;
  }
  const closing = line.charAt(at) === "/";
  if (closing) {
    at += 1;
  }
  if (
    line.slice(at, at + NAME.length) !== NAME ||
    isNameChar(line.charAt(at + NAME.length))
  ) {
    return undefined;
  }
  return closing ? "close" : "open";
}

/**
 * The source ranges from an opening highlight shortcode line to the end of the
 * first closing one. An opening tag with no closing tag gives no range. Pairs
 * do not nest. Ranges are in source order, end exclusive.
 */
export function findHugoCodeRanges(source: string): SourceRange[] {
  const ranges: SourceRange[] = [];
  let open: number | undefined;
  let lineStart = 0;
  while (lineStart <= source.length) {
    const newline = source.indexOf("\n", lineStart);
    const lineEnd = newline < 0 ? source.length : newline;
    const contentEnd =
      lineEnd > lineStart && source.charAt(lineEnd - 1) === "\r"
        ? lineEnd - 1
        : lineEnd;
    // A tag starts within the first few characters; capping the slice keeps the
    // per-line work small. Spaces beyond the cap hide a tag (see tagKind).
    const kind = tagKind(
      source.slice(lineStart, Math.min(contentEnd, lineStart + 64)),
    );
    if (kind === "open" && open === undefined) {
      open = lineStart;
    } else if (kind === "close" && open !== undefined) {
      ranges.push({ start: open, end: contentEnd });
      open = undefined;
    }
    if (newline < 0) {
      break;
    }
    lineStart = newline + 1;
  }
  return ranges;
}
