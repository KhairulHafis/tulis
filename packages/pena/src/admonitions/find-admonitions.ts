import type { Parent, Root, RootContent } from "mdast";
import { isIgnored, nodeRange, walkTree } from "../extract/tree-walk.js";
import type { SourceRange } from "../markdown/ignored-ranges.js";
import type { PreparedDoc } from "../prepare/prepare-doc.js";
import {
  isLabelWord,
  labelFormat,
  type AdmonitionLabelFormat,
} from "./label-format.js";

export type AdmonitionSyntax =
  | "blockquote-label"
  | "github-alert"
  | "directive"
  | "hugo-shortcode"
  | "paragraph-label";

export interface AdmonitionLabel {
  readonly format: AdmonitionLabelFormat | undefined;
  /** The strong node's range. */
  readonly range: SourceRange;
}

export interface Admonition {
  readonly syntax: AdmonitionSyntax;
  /** The type word in lower case: "note", "warning", "flag", ... */
  readonly kind: string;
  readonly range: SourceRange;
  /** Only for blockquote-label and paragraph-label. */
  readonly label: AdmonitionLabel | undefined;
}

const DIRECTIVE_NAMES: readonly string[] = [
  "note",
  "tip",
  "info",
  "warning",
  "danger",
  "caution",
  "important",
];

const HUGO_NAMES: readonly string[] = [
  "note",
  "tip",
  "important",
  "warning",
  "caution",
  "info",
  "danger",
  "alert",
];

/** The longest name above, plus one, so a longer word never matches. */
const MAX_NAME_LENGTH = 10;
const MAX_ALERT_LETTERS = 20;
const MAX_TAG_LENGTH = 1000;

function isAsciiLetter(char: string): boolean {
  return (char >= "a" && char <= "z") || (char >= "A" && char <= "Z");
}

/** End of the text, a space, a tab, CR or LF. */
function isBoundary(source: string, offset: number, end: number): boolean {
  if (offset >= end) {
    return true;
  }
  const char = source.charAt(offset);
  return char === " " || char === "\t" || char === "\r" || char === "\n";
}

/** The ASCII letters from `offset`, at most `max + 1` of them. */
function lettersAt(
  source: string,
  offset: number,
  end: number,
  max: number,
): string {
  let at = offset;
  while (at < end && at - offset <= max && isAsciiLetter(source.charAt(at))) {
    at += 1;
  }
  return source.slice(offset, at);
}

interface BoldLabel {
  readonly word: string;
  readonly label: AdmonitionLabel;
}

/** Rule 2 and 3: a paragraph that opens with a bold label word. */
function boldLabel(paragraph: Parent): BoldLabel | undefined {
  const strong = paragraph.children[0];
  if (strong?.type !== "strong" || strong.children.length !== 1) {
    return undefined;
  }
  const inner = strong.children[0];
  const range = nodeRange(strong);
  if (inner?.type !== "text" || range === undefined) {
    return undefined;
  }
  const insideColon = inner.value.endsWith(":");
  const word = insideColon ? inner.value.slice(0, -1) : inner.value;
  if (!isLabelWord(word)) {
    return undefined;
  }
  const next = paragraph.children[1];
  const hasColon =
    insideColon || (next?.type === "text" && next.value.startsWith(":"));
  return { word, label: { format: labelFormat(word, hasColon), range } };
}

/** Rule 4a: `[!kind]` at the start of the paragraph. Returns the kind. */
function githubAlertKind(
  source: string,
  paragraph: SourceRange,
): string | undefined {
  const { start, end } = paragraph;
  if (source.slice(start, start + 2) !== "[!") {
    return undefined;
  }
  const letters = lettersAt(source, start + 2, end, MAX_ALERT_LETTERS);
  if (letters.length < 1 || letters.length > MAX_ALERT_LETTERS) {
    return undefined;
  }
  const close = start + 2 + letters.length;
  if (close >= end || source.charAt(close) !== "]") {
    return undefined;
  }
  return isBoundary(source, close + 1, end) ? letters.toLowerCase() : undefined;
}

/** Rule 6a: `:::name` at the start of the paragraph. Returns the name. */
function oldDirectiveName(
  source: string,
  paragraph: SourceRange,
): string | undefined {
  const { start, end } = paragraph;
  if (source.slice(start, start + 3) !== ":::") {
    return undefined;
  }
  const name = lettersAt(source, start + 3, end, MAX_NAME_LENGTH);
  if (!DIRECTIVE_NAMES.includes(name)) {
    return undefined;
  }
  return isBoundary(source, start + 3 + name.length, end) ? name : undefined;
}

/** Rule 6c on one line: the tag range and name, or undefined. */
function hugoTagOnLine(
  source: string,
  lineStart: number,
  lineEnd: number,
): { range: SourceRange; name: string } | undefined {
  let at = lineStart;
  while (at < lineEnd && " \t>".includes(source.charAt(at))) {
    at += 1;
  }
  const open = source.slice(at, at + 3);
  if (open !== "{{<" && open !== "{{%") {
    return undefined;
  }
  const tagStart = at;
  at += 3;
  while (at < lineEnd && " \t".includes(source.charAt(at))) {
    at += 1;
  }
  const name = lettersAt(source, at, lineEnd, MAX_NAME_LENGTH).toLowerCase();
  if (!HUGO_NAMES.includes(name)) {
    return undefined;
  }
  at += name.length;
  const after = at < lineEnd ? source.charAt(at) : "";
  if (after !== " " && after !== "\t" && after !== ">" && after !== "%") {
    return undefined;
  }
  const marker = open === "{{<" ? ">}}" : "%}}";
  const windowEnd = Math.min(lineEnd, tagStart + MAX_TAG_LENGTH);
  const found = source.slice(at, windowEnd).indexOf(marker);
  if (found < 0) {
    return undefined;
  }
  return { range: { start: tagStart, end: at + found + 3 }, name };
}

/** Rule 6c: every tag in the paragraph, one per line at most. */
function hugoTags(source: string, paragraph: SourceRange): Admonition[] {
  const tags: Admonition[] = [];
  let lineStart = paragraph.start;
  while (lineStart <= paragraph.end) {
    const newline = source.indexOf("\n", lineStart);
    const lineEnd =
      newline < 0 || newline > paragraph.end ? paragraph.end : newline;
    const tag = hugoTagOnLine(source, lineStart, lineEnd);
    if (tag !== undefined) {
      tags.push({
        syntax: "hugo-shortcode",
        kind: tag.name,
        range: tag.range,
        label: undefined,
      });
    }
    lineStart = lineEnd + 1;
  }
  return tags;
}

function blockquoteAdmonition(
  source: string,
  node: Parent,
  range: SourceRange,
): Admonition | undefined {
  const first = node.children[0];
  if (first?.type !== "paragraph") {
    return undefined;
  }
  const firstRange = nodeRange(first);
  if (firstRange === undefined) {
    return undefined;
  }
  const alert = githubAlertKind(source, firstRange);
  if (alert !== undefined) {
    return { syntax: "github-alert", kind: alert, range, label: undefined };
  }
  const bold = boldLabel(first);
  if (bold === undefined) {
    return undefined;
  }
  return {
    syntax: "blockquote-label",
    kind: bold.word.toLowerCase(),
    range,
    label: bold.label,
  };
}

function paragraphAdmonitions(
  doc: PreparedDoc,
  node: Parent,
  parent: Parent | undefined,
  range: SourceRange,
): { found: Admonition[]; recorded: boolean } {
  const source = doc.parsed.source;
  const old = oldDirectiveName(source, range);
  if (old !== undefined) {
    return {
      found: [{ syntax: "directive", kind: old, range, label: undefined }],
      recorded: true,
    };
  }
  const firstInQuote =
    parent?.type === "blockquote" && parent.children[0] === node;
  const bold = firstInQuote ? undefined : boldLabel(node);
  if (bold !== undefined) {
    return {
      found: [
        {
          syntax: "paragraph-label",
          kind: bold.word.toLowerCase(),
          range,
          label: bold.label,
        },
      ],
      recorded: true,
    };
  }
  if (doc.syntax !== "markdown") {
    return { found: [], recorded: false };
  }
  return { found: hugoTags(source, range), recorded: false };
}

function asParent(node: Root | RootContent): Parent | undefined {
  return "children" in node ? node : undefined;
}

const cache = new WeakMap<PreparedDoc, readonly Admonition[]>();

/** Finds the admonitions of a prepared doc, in document order. Cached per doc. */
export function findAdmonitions(doc: PreparedDoc): readonly Admonition[] {
  const cached = cache.get(doc);
  if (cached !== undefined) {
    return cached;
  }
  const result: Admonition[] = [];
  const source = doc.parsed.source;
  const keep = (admonition: Admonition): void => {
    if (!isIgnored(doc, admonition.range)) {
      result.push(admonition);
    }
  };
  walkTree(doc, (node, parent) => {
    const range = nodeRange(node);
    const asNode = asParent(node);
    if (range === undefined || asNode === undefined) {
      return undefined;
    }
    if (node.type === "blockquote") {
      const found = blockquoteAdmonition(source, asNode, range);
      if (found === undefined) {
        return undefined;
      }
      keep(found);
      return "skip-children";
    }
    if (node.type === "containerDirective") {
      if (!DIRECTIVE_NAMES.includes(node.name.toLowerCase())) {
        return undefined;
      }
      keep({
        syntax: "directive",
        kind: node.name.toLowerCase(),
        range,
        label: undefined,
      });
      return "skip-children";
    }
    if (node.type === "paragraph") {
      const { found, recorded } = paragraphAdmonitions(
        doc,
        asNode,
        parent,
        range,
      );
      found.forEach(keep);
      return recorded ? "skip-children" : undefined;
    }
    return undefined;
  });
  cache.set(doc, result);
  return result;
}
