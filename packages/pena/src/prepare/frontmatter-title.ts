import { tokenizeSentence, type Token } from "../language/tokens.js";
import type { SourceRange } from "../markdown/ignored-ranges.js";
import type { MaskOptions } from "../markdown/mask-block.js";
import type {
  MaskedSegment,
  MaskedText,
  Placeholder,
} from "../markdown/masked-text.js";
import { parseMarkdown } from "../markdown/parse-markdown.js";
import type { ParsedMarkdown } from "../markdown/parse-markdown.js";
import { collectProseBlocks, proseUnit } from "../markdown/prose-units.js";

/** The title read as a one-line H1: masked text, its tokens, and the range. */
export interface FrontmatterTitleParts {
  readonly masked: MaskedText;
  readonly tokens: readonly Token[];
  readonly range: SourceRange;
}

const PREFIX = "# ";
const LINE_SEPARATOR = String.fromCodePoint(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCodePoint(0x2029);
const EMPTY_MASKED: MaskedText = { text: "", segments: [], placeholders: [] };

/** Replaces every line break with a space; the length does not change. */
function collapseLineBreaks(text: string): string {
  let result = "";
  for (let i = 0; i < text.length; i += 1) {
    const char = text.charAt(i);
    const isBreak =
      char === "\r" ||
      char === "\n" ||
      char === LINE_SEPARATOR ||
      char === PARAGRAPH_SEPARATOR;
    result += isBreak ? " " : char;
  }
  return result;
}

function shift(range: SourceRange): SourceRange {
  return {
    start: Math.max(0, range.start - PREFIX.length),
    end: Math.max(0, range.end - PREFIX.length),
  };
}

function shiftSegment(segment: MaskedSegment): MaskedSegment {
  const source = shift({ start: segment.sourceStart, end: segment.sourceEnd });
  return { ...segment, sourceStart: source.start, sourceEnd: source.end };
}

function shiftPlaceholder(placeholder: Placeholder): Placeholder {
  return { ...placeholder, source: shift(placeholder.source) };
}

function shiftToken(token: Token): Token {
  return { ...token, source: shift(token.source) };
}

/** Masks and tokenizes the title. Never throws; empty when nothing parses. */
export function maskTitle(
  title: string,
  options: MaskOptions,
): { readonly masked: MaskedText; readonly tokens: readonly Token[] } {
  const empty = { masked: EMPTY_MASKED, tokens: [] };
  try {
    const parsed = parseMarkdown(
      PREFIX + collapseLineBreaks(title),
      "markdown",
    );
    if (parsed.kind !== "parsed") {
      return empty;
    }
    const block = collectProseBlocks(parsed.tree).find(
      (candidate) => candidate.type === "heading",
    );
    if (block === undefined) {
      return empty;
    }
    const unit = proseUnit(block, parsed, options);
    const sentence = unit.sentences[0];
    if (sentence === undefined) {
      return empty;
    }
    const tokens = tokenizeSentence(unit.masked, sentence);
    return {
      masked: {
        text: unit.masked.text,
        segments: unit.masked.segments.map(shiftSegment),
        placeholders: unit.masked.placeholders.map(shiftPlaceholder),
      },
      tokens: tokens.map(shiftToken),
    };
  } catch {
    return empty;
  }
}

/** True when the line starts with the key `title` (bare or quoted) and a separator; returns the offset after the separator. */
function afterTitleKey(line: string): number | undefined {
  let at = 0;
  const quote = line.charAt(0);
  const quoted = quote === '"' || quote === "'";
  if (quoted) {
    at = 1;
  }
  if (line.slice(at, at + 5) !== "title") {
    return undefined;
  }
  at += 5;
  if (quoted) {
    if (line.charAt(at) !== quote) {
      return undefined;
    }
    at += 1;
  }
  while (line.charAt(at) === " " || line.charAt(at) === "\t") {
    at += 1;
  }
  const separator = line.charAt(at);
  return separator === ":" || separator === "=" ? at + 1 : undefined;
}

/**
 * Where the title sits in the doc source. On the `title` line: the title text
 * when it appears literally after the separator, otherwise the whole line
 * without its line ending. Falls back to the opening fence line.
 */
function titleRange(
  parsed: ParsedMarkdown,
  text: string,
): SourceRange | undefined {
  const frontmatter = parsed.frontmatter;
  const from = frontmatter?.position.start.offset;
  const to = frontmatter?.position.end.offset;
  if (from === undefined || to === undefined) {
    return undefined;
  }
  const source = parsed.source;
  let fallback: SourceRange | undefined;
  let lineStart = from;
  let first = true;
  while (lineStart < to) {
    let lineEnd = source.indexOf("\n", lineStart);
    if (lineEnd < 0 || lineEnd > to) {
      lineEnd = to;
    }
    const contentEnd =
      lineEnd > lineStart && source.charAt(lineEnd - 1) === "\r"
        ? lineEnd - 1
        : lineEnd;
    if (first) {
      fallback = { start: lineStart, end: contentEnd };
      first = false;
    } else {
      const line = source.slice(lineStart, contentEnd);
      const after = afterTitleKey(line);
      if (after !== undefined) {
        const found = line.indexOf(text, after);
        return found < 0
          ? { start: lineStart, end: contentEnd }
          : { start: lineStart + found, end: lineStart + found + text.length };
      }
    }
    lineStart = lineEnd + 1;
  }
  return fallback;
}

export function frontmatterTitleParts(
  parsed: ParsedMarkdown,
  text: string,
  options: MaskOptions,
): FrontmatterTitleParts {
  const { masked, tokens } = maskTitle(text, options);
  const range = titleRange(parsed, text) ?? { start: 0, end: 0 };
  return { masked, tokens, range };
}
