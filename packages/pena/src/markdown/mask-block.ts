import type { Heading, Paragraph, RootContent, TableCell, Text } from "mdast";
import { mdxCommentBody } from "./ignore-comment.js";
import {
  MaskedTextBuilder,
  sliceRuns,
  alignText,
  type MaskedText,
  type PlaceholderKind,
  type TextRun,
} from "./masked-text.js";
import type { ParsedMarkdown } from "./parse-markdown.js";
import { findProductNames, type ProductNameMatcher } from "./product-names.js";
import { findTemplateTags, type TemplateTag } from "./template-tags.js";

export type MaskableBlock = Paragraph | Heading | TableCell;

export interface MaskOptions {
  /** Product names to mask as {PRODUCT}. None when left out. */
  readonly productNames?: ProductNameMatcher;
}

/** Words in a bold span at most this many to count as a UI label. */
export const MAX_UI_LABEL_WORDS = 6;

/** Longest HTML tag name read; a longer name is not treated as a tag. */
const MAX_TAG_NAME_LENGTH = 100;

type Touch = "none" | "inside" | "partial";

interface Span {
  readonly start: number;
  readonly end: number;
}

/** What an inline html node is, judged from its value. */
interface HtmlTag {
  readonly kind: "open" | "close" | "br" | "other";
  readonly name: string;
}

const OTHER_TAG: HtmlTag = { kind: "other", name: "" };

function isNameStart(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isNameChar(code: number): boolean {
  return (
    isNameStart(code) ||
    (code >= 48 && code <= 57) ||
    code === 45 ||
    code === 58 ||
    code === 95 ||
    code === 46
  );
}

function parseHtmlTag(value: string): HtmlTag {
  if (value.charCodeAt(0) !== 60) {
    return OTHER_TAG;
  }
  const closing = value.charCodeAt(1) === 47;
  const nameStart = closing ? 2 : 1;
  if (!isNameStart(value.charCodeAt(nameStart))) {
    return OTHER_TAG;
  }
  let at = nameStart;
  while (
    at < value.length &&
    at - nameStart <= MAX_TAG_NAME_LENGTH &&
    isNameChar(value.charCodeAt(at))
  ) {
    at += 1;
  }
  if (at - nameStart > MAX_TAG_NAME_LENGTH) {
    return OTHER_TAG;
  }
  const name = value.slice(nameStart, at).toLowerCase();
  if (name === "br" && !closing) {
    return { kind: "br", name };
  }
  if (closing) {
    return { kind: "close", name };
  }
  return value.trimEnd().endsWith("/>") ? OTHER_TAG : { kind: "open", name };
}

/**
 * For each opening tag that has a closing tag among the siblings, the index of
 * the closer. One pass with a stack per tag name.
 */
function pairHtml(
  infos: readonly (HtmlTag | undefined)[],
): Map<number, number> {
  const pairs = new Map<number, number>();
  const stacks = new Map<string, number[]>();
  for (let i = 0; i < infos.length; i += 1) {
    const info = infos[i];
    if (info === undefined) {
      continue;
    }
    if (info.kind === "open") {
      const stack = stacks.get(info.name);
      if (stack === undefined) {
        stacks.set(info.name, [i]);
      } else {
        stack.push(i);
      }
    } else if (info.kind === "close") {
      const opener = stacks.get(info.name)?.pop();
      if (opener !== undefined) {
        pairs.set(opener, i);
      }
    }
  }
  return pairs;
}

function isWhitespace(char: string): boolean {
  return char.trim() === "";
}

interface WordCount {
  words: number;
  inWord: boolean;
  last: string;
}

/** Counts words in all descendant text and inline code, stopping once over the limit. */
function countWords(nodes: readonly RootContent[], count: WordCount): void {
  for (const node of nodes) {
    if (count.words > MAX_UI_LABEL_WORDS) {
      return;
    }
    if (node.type === "text" || node.type === "inlineCode") {
      for (let i = 0; i < node.value.length; i += 1) {
        const char = node.value.charAt(i);
        if (isWhitespace(char)) {
          count.inWord = false;
          continue;
        }
        if (!count.inWord) {
          count.inWord = true;
          count.words += 1;
          if (count.words > MAX_UI_LABEL_WORDS) {
            return;
          }
        }
        count.last = char;
      }
    } else if ("children" in node) {
      countWords(node.children, count);
    }
  }
}

function offsets(node: RootContent): Span | undefined {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined ? undefined : { start, end };
}

/** Source spans of every inline code node under the nodes, in source order. */
function collectCodeSpans(nodes: readonly RootContent[], into: Span[]): void {
  for (const node of nodes) {
    if (node.type === "inlineCode") {
      const span = offsets(node);
      if (span !== undefined) {
        into.push(span);
      }
    } else if ("children" in node) {
      collectCodeSpans(node.children, into);
    }
  }
}

/** The template tags that do not overlap inline code. */
function tagsOutsideCode(
  tags: readonly TemplateTag[],
  codes: readonly Span[],
): TemplateTag[] {
  const kept: TemplateTag[] = [];
  let c = 0;
  for (const tag of tags) {
    while (c < codes.length && (codes[c]?.end ?? 0) <= tag.start) {
      c += 1;
    }
    const code = codes[c];
    if (code === undefined || code.start >= tag.end) {
      kept.push(tag);
    }
  }
  return kept;
}

/** The runs that touch value offsets [from, to), found by binary search. */
function runsBetween(
  runs: readonly TextRun[],
  from: number,
  to: number,
): TextRun[] {
  let low = 0;
  let high = runs.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((runs[middle]?.valueEnd ?? 0) > from) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  let stop = low;
  while (stop < runs.length && (runs[stop]?.valueStart ?? 0) < to) {
    stop += 1;
  }
  return sliceRuns(runs.slice(low, stop), from, to);
}

class Masker {
  private readonly builder = new MaskedTextBuilder();
  /** Index of the first template tag not yet output. */
  private nextTag = 0;

  constructor(
    private readonly source: string,
    private readonly tags: readonly TemplateTag[],
    private readonly productNames: ProductNameMatcher | undefined,
  ) {}

  result(): MaskedText {
    this.flush(Number.POSITIVE_INFINITY);
    return this.builder.build();
  }

  /** Outputs the template tags that start at or before `offset`. */
  private flush(offset: number): void {
    for (;;) {
      const tag = this.tags[this.nextTag];
      if (tag === undefined || tag.start > offset) {
        return;
      }
      this.builder.appendPlaceholder("SHORTCODE", tag.start, tag.end);
      this.nextTag += 1;
    }
  }

  /** Drops the tags that start before `end`: an html pair wraps them. */
  private skipTags(end: number): void {
    for (;;) {
      const tag = this.tags[this.nextTag];
      if (tag === undefined || tag.start >= end) {
        return;
      }
      this.nextTag += 1;
    }
  }

  /** Index of the first tag whose end is after `offset`, by binary search. */
  private firstTagEndingAfter(offset: number): number {
    let low = 0;
    let high = this.tags.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((this.tags[middle]?.end ?? 0) > offset) {
        high = middle;
      } else {
        low = middle + 1;
      }
    }
    return low;
  }

  private touches(start: number, end: number): Touch {
    const low = this.firstTagEndingAfter(start);
    const tag = this.tags[low];
    if (tag === undefined || tag.start >= end) {
      return "none";
    }
    return tag.start <= start && tag.end >= end ? "inside" : "partial";
  }

  private placeholder(kind: PlaceholderKind, span: Span): void {
    this.flush(span.start);
    this.builder.appendPlaceholder(kind, span.start, span.end);
  }

  /** Walks sibling nodes. `block` is true for the block's own children. */
  walkList(nodes: readonly RootContent[], block: boolean): void {
    const infos = nodes.map((node) =>
      node.type === "html" ? parseHtmlTag(node.value) : undefined,
    );
    const pairs = pairHtml(infos);
    let i = 0;
    while (i < nodes.length) {
      const node = nodes[i];
      if (node === undefined) {
        break;
      }
      const info = infos[i];
      const closer = pairs.get(i);
      if (info !== undefined && closer !== undefined) {
        const end = this.pairedHtml(nodes, i, closer);
        if (end !== undefined) {
          i = end + 1;
          continue;
        }
      } else if (info !== undefined) {
        this.singleHtml(node, info);
      } else {
        this.walkNode(
          node,
          block && i === 0 ? nodes[1] : undefined,
          block && i === 0,
        );
      }
      i += 1;
    }
  }

  /** Outputs one placeholder for a matched pair. Undefined when a tag blocks it. */
  private pairedHtml(
    nodes: readonly RootContent[],
    open: number,
    close: number,
  ): number | undefined {
    const first = nodes[open];
    const last = nodes[close];
    const from = first === undefined ? undefined : offsets(first);
    const to = last === undefined ? undefined : offsets(last);
    if (from === undefined || to === undefined) {
      return undefined;
    }
    if (
      this.touches(from.start, from.end) !== "none" ||
      this.touches(to.start, to.end) !== "none"
    ) {
      return undefined;
    }
    this.placeholder("HTML", { start: from.start, end: to.end });
    this.skipTags(to.end);
    return close;
  }

  private singleHtml(node: RootContent, info: HtmlTag): void {
    const span = offsets(node);
    if (span === undefined || info.kind !== "br") {
      return;
    }
    if (this.touches(span.start, span.end) !== "none") {
      return;
    }
    this.flush(span.start);
    this.builder.appendReplacement("\n", span.start, span.end);
  }

  private walkChildren(node: RootContent): void {
    if ("children" in node) {
      this.walkList(node.children, false);
    }
  }

  private walkNode(
    node: RootContent,
    next: RootContent | undefined,
    firstInBlock: boolean,
  ): void {
    if (node.type === "text") {
      this.text(node);
      return;
    }
    const span = offsets(node);
    if (span === undefined) {
      return;
    }
    this.flush(span.start);
    const touch = this.touches(span.start, span.end);
    if (touch === "inside") {
      return;
    }
    const whole = touch === "none";
    const type: string = node.type;
    switch (type) {
      case "inlineCode":
        if (whole) {
          this.placeholder("CODE", span);
        }
        return;
      case "strong":
        if (whole && this.isUiLabel(node, next, firstInBlock)) {
          this.placeholder("UI", span);
        } else {
          this.walkChildren(node);
        }
        return;
      case "link":
      case "linkReference":
        if (whole && this.source.charAt(span.start) !== "[") {
          this.placeholder("URL", span);
        } else {
          this.walkChildren(node);
        }
        return;
      case "image":
      case "imageReference":
        if (whole) {
          this.placeholder("IMAGE", span);
        }
        return;
      case "break":
        if (whole) {
          this.builder.appendReplacement("\n", span.start, span.end);
        }
        return;
      case "footnoteReference":
        return;
      case "mdxJsxTextElement":
        if (whole) {
          this.placeholder("HTML", span);
        } else {
          this.walkChildren(node);
        }
        return;
      case "mdxTextExpression":
        if (
          "value" in node &&
          typeof node.value === "string" &&
          mdxCommentBody(node.value) !== undefined
        ) {
          return;
        }
        if (whole) {
          this.placeholder("SHORTCODE", span);
        }
        return;
      default:
        this.walkChildren(node);
    }
  }

  private isUiLabel(
    node: RootContent,
    next: RootContent | undefined,
    firstInBlock: boolean,
  ): boolean {
    if (!("children" in node)) {
      return false;
    }
    const count: WordCount = { words: 0, inWord: false, last: "" };
    countWords(node.children, count);
    if (count.words < 1 || count.words > MAX_UI_LABEL_WORDS) {
      return false;
    }
    if (firstInBlock) {
      const colonAfter = next?.type === "text" && next.value.startsWith(":");
      if (count.last === ":" || colonAfter) {
        return false;
      }
    }
    return true;
  }

  /** The value ranges of a text node that no template tag covers. */
  private keptRanges(
    runs: readonly TextRun[],
    length: number,
    span: Span,
  ): Span[] {
    const removed: Span[] = [];
    let k = this.firstTagEndingAfter(span.start);
    for (const run of runs) {
      while (
        k < this.tags.length &&
        (this.tags[k]?.end ?? 0) <= run.sourceStart
      ) {
        k += 1;
      }
      let m = k;
      for (;;) {
        const tag = this.tags[m];
        if (tag === undefined || tag.start >= run.sourceEnd) {
          break;
        }
        if (run.atomic) {
          removed.push({ start: run.valueStart, end: run.valueEnd });
          break;
        }
        const from = Math.max(tag.start, run.sourceStart) - run.sourceStart;
        const to = Math.min(tag.end, run.sourceEnd) - run.sourceStart;
        removed.push({
          start: run.valueStart + from,
          end: run.valueStart + to,
        });
        m += 1;
      }
    }
    const kept: Span[] = [];
    let cursor = 0;
    for (const range of removed) {
      if (range.start > cursor) {
        kept.push({ start: cursor, end: range.start });
      }
      cursor = Math.max(cursor, range.end);
    }
    if (cursor < length) {
      kept.push({ start: cursor, end: length });
    }
    return kept;
  }

  private text(node: Text): void {
    const span = offsets(node);
    if (span === undefined) {
      return;
    }
    const value = node.value;
    const runs = alignText(value, this.source, span.start, span.end);
    for (const range of this.keptRanges(runs, value.length, span)) {
      this.keptText(value, runs, range);
    }
  }

  private emitRuns(value: string, runs: readonly TextRun[]): void {
    const first = runs[0];
    if (first === undefined) {
      return;
    }
    this.flush(first.sourceStart);
    this.builder.appendRuns(value, runs);
  }

  private keptText(value: string, runs: readonly TextRun[], range: Span): void {
    let cursor = range.start;
    if (this.productNames !== undefined) {
      const piece = value.slice(range.start, range.end);
      for (const match of findProductNames(this.productNames, piece)) {
        const from = range.start + match.start;
        const to = range.start + match.end;
        const matchRuns = runsBetween(runs, from, to);
        const first = matchRuns[0];
        const last = matchRuns[matchRuns.length - 1];
        // A match that cuts into one atomic run cannot be located exactly.
        if (
          first === undefined ||
          last === undefined ||
          from < cursor ||
          matchRuns.some(
            (run) => run.atomic && (run.valueStart < from || run.valueEnd > to),
          )
        ) {
          continue;
        }
        this.emitRuns(value, runsBetween(runs, cursor, from));
        this.placeholder("PRODUCT", {
          start: first.sourceStart,
          end: last.sourceEnd,
        });
        cursor = to;
      }
    }
    this.emitRuns(value, runsBetween(runs, cursor, range.end));
  }
}

/**
 * Masks one paragraph, heading or table cell: inline code, bold UI labels,
 * product names, template tags, bare URLs, images and inline HTML become
 * placeholders, and every piece keeps an exact map back to the source.
 */
export function maskBlock(
  block: MaskableBlock,
  parsed: ParsedMarkdown,
  options: MaskOptions = {},
): MaskedText {
  const first = block.children[0];
  const last = block.children[block.children.length - 1];
  const from = first === undefined ? undefined : offsets(first);
  const to = last === undefined ? undefined : offsets(last);
  let tags: TemplateTag[] = [];
  if (parsed.syntax === "markdown" && from !== undefined && to !== undefined) {
    const codes: Span[] = [];
    collectCodeSpans(block.children, codes);
    tags = tagsOutsideCode(
      findTemplateTags(parsed.source, from.start, to.end),
      codes,
    );
  }
  const masker = new Masker(parsed.source, tags, options.productNames);
  masker.walkList(block.children, true);
  return masker.result();
}
