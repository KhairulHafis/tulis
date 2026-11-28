import type { Root } from "mdast";
import { findAdmonitions } from "../admonitions/find-admonitions.js";
import { isIgnored, nodeRange } from "../extract/tree-walk.js";
import type { SourceRange } from "../markdown/ignored-ranges.js";
import type { PreparedBlock, PreparedDoc } from "../prepare/prepare-doc.js";

export type IntroValue = "yes" | "no";

const MAX_LOOK_AHEAD = 50;
const MAX_TAG_LENGTH = 1000;
const NAME_CHAR = /^[A-Za-z0-9_-]$/u;

type Child = Root["children"][number];

/** The shortcode source when the paragraph's tokens are exactly one SHORTCODE. */
function singleTag(
  block: PreparedBlock | undefined,
  source: string,
): string | undefined {
  const tokens = block?.sentences.flatMap((s) => [...s.tokens]) ?? [];
  const only = tokens.length === 1 ? tokens[0] : undefined;
  if (only?.placeholder !== "SHORTCODE") {
    return undefined;
  }
  const { start, end } = only.source;
  return end - start > MAX_TAG_LENGTH ? undefined : source.slice(start, end);
}

function isTemplateOnly(block: PreparedBlock | undefined): boolean {
  if (block === undefined) {
    return false;
  }
  let count = 0;
  for (const sentence of block.sentences) {
    for (const token of sentence.tokens) {
      if (token.placeholder !== "SHORTCODE") {
        return false;
      }
      count += 1;
    }
  }
  return count > 0;
}

function skipSpaces(text: string, from: number): number {
  let at = from;
  while (text.charAt(at) === " ") {
    at += 1;
  }
  return at;
}

/** The name of a block-opening tag, or undefined. */
function openingName(tag: string): string | undefined {
  if (!tag.startsWith("{{<") && !tag.startsWith("{{%")) {
    return undefined;
  }
  if (tag.endsWith("/>}}") || tag.endsWith("/%}}")) {
    return undefined;
  }
  const start = skipSpaces(tag, 3);
  let end = start;
  while (end < tag.length && NAME_CHAR.test(tag.charAt(end))) {
    end += 1;
  }
  return end === start ? undefined : tag.slice(start, end);
}

function isClosingTag(tag: string, name: string): boolean {
  const open = tag.slice(0, 3);
  if (open !== "{{<" && open !== "{{%") {
    return false;
  }
  const close = open === "{{<" ? ">}}" : "%}}";
  let at = skipSpaces(tag, 3);
  if (tag.charAt(at) !== "/") {
    return false;
  }
  at += 1;
  if (!tag.startsWith(name, at)) {
    return false;
  }
  at = skipSpaces(tag, at + name.length);
  return tag.slice(at) === close;
}

function isSkippedNode(node: Child): boolean {
  const type: string = node.type;
  if (type === "yaml" || type === "toml" || type === "mdxjsEsm") {
    return true;
  }
  return (
    type === "html" &&
    "value" in node &&
    node.value.trimStart().startsWith("<!--")
  );
}

/**
 * Whether the page opens with a paragraph after its title; one result per doc.
 * Front matter, comments, MDX imports, template-only paragraphs (and paired
 * template tags with what they enclose) and note boxes (notes, warnings, tips,
 * with every top-level node inside them) are skipped. The first node left is
 * the first block: a paragraph gives "yes", anything else "no".
 */
export function findIntro(
  doc: PreparedDoc,
): { readonly value: IntroValue; readonly range: SourceRange } | undefined {
  const title = doc.title;
  if (title === undefined) {
    return undefined;
  }
  const children = doc.parsed.tree.children;
  let index = 0;
  if (title.from === "h1") {
    index = children.findIndex(
      (node) =>
        node.type === "heading" &&
        node.depth === 1 &&
        node.position?.start.line === title.line,
    );
    if (index < 0) {
      return undefined;
    }
    index += 1;
  }
  const source = doc.parsed.source;
  const paragraphs = new Map<number, PreparedBlock>();
  for (const block of doc.blocks) {
    const start = block.node.position?.start.offset;
    if (block.kind === "paragraph" && start !== undefined) {
      paragraphs.set(start, block);
    }
  }
  // Start offset to the furthest end of an admonition starting there.
  const admonitionEnds = new Map<number, number>();
  for (const admonition of findAdmonitions(doc)) {
    const { start, end } = admonition.range;
    admonitionEnds.set(start, Math.max(end, admonitionEnds.get(start) ?? end));
  }
  let skipUntil = 0;
  const blockAt = (node: Child): PreparedBlock | undefined => {
    const start = node.position?.start.offset;
    return start === undefined ? undefined : paragraphs.get(start);
  };

  while (index < children.length) {
    const node = children[index];
    if (node === undefined) {
      return undefined;
    }
    const start = node.position?.start.offset;
    const noteEnd = start === undefined ? undefined : admonitionEnds.get(start);
    if (noteEnd !== undefined) {
      skipUntil = Math.max(skipUntil, noteEnd);
    }
    if (start !== undefined && start < skipUntil) {
      index += 1;
      continue;
    }
    if (isSkippedNode(node)) {
      index += 1;
      continue;
    }
    if (node.type === "paragraph" && isTemplateOnly(blockAt(node))) {
      index = afterTemplate(children, index, source, blockAt);
      continue;
    }
    const range = nodeRange(node);
    if (range === undefined || isIgnored(doc, range)) {
      return undefined;
    }
    if (node.type === "paragraph") {
      return blockAt(node) === undefined ? undefined : { value: "yes", range };
    }
    return { value: "no", range };
  }
  return undefined;
}

/** The index after a template paragraph, skipping through its closing tag when paired. */
function afterTemplate(
  children: readonly Child[],
  index: number,
  source: string,
  blockAt: (node: Child) => PreparedBlock | undefined,
): number {
  const node = children[index];
  const tag = node === undefined ? undefined : singleTag(blockAt(node), source);
  const name = tag === undefined ? undefined : openingName(tag);
  if (name === undefined) {
    return index + 1;
  }
  const last = Math.min(children.length - 1, index + MAX_LOOK_AHEAD);
  for (let at = index + 1; at <= last; at += 1) {
    const candidate = children[at];
    if (candidate?.type !== "paragraph") {
      continue;
    }
    const closing = singleTag(blockAt(candidate), source);
    if (closing !== undefined && isClosingTag(closing, name)) {
      return at + 1;
    }
  }
  return index + 1;
}
