import type { SourceRange } from "./ignored-ranges.js";

/** hugo: {{< >}} and {{% %}}. liquid: {% %} and {{ }} (Liquid and Jinja share these). */
export type TemplateTagSyntax = "hugo" | "liquid";

export interface TemplateTag extends SourceRange {
  readonly syntax: TemplateTagSyntax;
}

/** Longest tag, delimiters included, in UTF-16 code units. */
export const MAX_TEMPLATE_TAG_LENGTH = 1000;

interface Delimiters {
  readonly open: string;
  readonly close: string;
  readonly syntax: TemplateTagSyntax;
}

/** Tried in this order at each `{`. */
const DELIMITERS: readonly Delimiters[] = [
  { open: "{{<", close: ">}}", syntax: "hugo" },
  { open: "{{%", close: "%}}", syntax: "hugo" },
  { open: "{{", close: "}}", syntax: "liquid" },
  { open: "{%", close: "%}", syntax: "liquid" },
];

const NONE = Number.POSITIVE_INFINITY;

function isLineEnding(code: number): boolean {
  return code === 10 || code === 13;
}

/** Length of the line ending at `at` (\r\n counts as one), or 0. */
function lineEndingLength(text: string, at: number): number {
  const code = text.charCodeAt(at);
  if (code === 13) {
    return text.charCodeAt(at + 1) === 10 ? 2 : 1;
  }
  return code === 10 ? 1 : 0;
}

/**
 * Finds the first blank line whose first line ending starts at or after
 * `from`. Returns its start and the offset just past its second line ending.
 */
function findBlankLine(
  text: string,
  from: number,
): { start: number; end: number } | undefined {
  let at = from;
  while (at < text.length) {
    if (!isLineEnding(text.charCodeAt(at))) {
      at += 1;
      continue;
    }
    let next = at + lineEndingLength(text, at);
    while (text.charCodeAt(next) === 32 || text.charCodeAt(next) === 9) {
      next += 1;
    }
    const second = lineEndingLength(text, next);
    if (second > 0) {
      return { start: at, end: next + second };
    }
    at += 1;
  }
  return undefined;
}

/** Tags inside source.slice(start, end), in order, not overlapping. Offsets are into `source`. */
export function findTemplateTags(
  source: string,
  start = 0,
  end: number = source.length,
): TemplateTag[] {
  const from = Math.max(0, Math.min(start, source.length));
  const to = Math.max(from, Math.min(end, source.length));
  const text = source.slice(from, to);
  const tags: TemplateTag[] = [];

  // Next closer position at or after the last query, per delimiter. Queries
  // only move forward, so each is searched again only once the scan passes it.
  const nextClose: number[] = DELIMITERS.map(() => -1);
  // Next blank line at or after the scan position.
  let blankStart = -1;
  let blankEnd = NONE;

  let i = 0;
  while (i < text.length) {
    if (text.charCodeAt(i) !== 123) {
      i = text.indexOf("{", i);
      if (i === -1) {
        break;
      }
    }
    if (blankStart < i) {
      const blank = findBlankLine(text, i);
      blankStart = blank === undefined ? NONE : blank.start;
      blankEnd = blank === undefined ? NONE : blank.end;
    }
    let found: TemplateTag | undefined;
    for (let d = 0; d < DELIMITERS.length; d += 1) {
      const delimiters = DELIMITERS[d];
      if (delimiters === undefined || !text.startsWith(delimiters.open, i)) {
        continue;
      }
      const searchFrom = i + delimiters.open.length;
      let closeAt = nextClose[d] ?? -1;
      if (closeAt < searchFrom) {
        const hit = text.indexOf(delimiters.close, searchFrom);
        closeAt = hit === -1 ? NONE : hit;
        nextClose[d] = closeAt;
      }
      if (closeAt === NONE) {
        continue;
      }
      const tagEnd = closeAt + delimiters.close.length;
      if (tagEnd - i > MAX_TEMPLATE_TAG_LENGTH || blankEnd <= tagEnd) {
        continue;
      }
      found = {
        start: from + i,
        end: from + tagEnd,
        syntax: delimiters.syntax,
      };
      break;
    }
    if (found === undefined) {
      i += 1;
    } else {
      tags.push(found);
      i = found.end - from;
    }
  }
  return tags;
}
