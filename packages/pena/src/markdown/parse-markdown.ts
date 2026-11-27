import type { Root, RootContent } from "mdast";
import remarkDirective from "remark-directive";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { SKIP, visit } from "unist-util-visit";
import { toSafeText } from "../git/safe-text.js";

/** The `unist` types package is not a direct dependency, so take Position from mdast. */
type Position = NonNullable<Root["position"]>;

export type MarkdownSyntax = "markdown" | "mdx";

/** "markdown" for .md, "mdx" for .mdx (extension compared case-insensitively), undefined otherwise. Accepts "/" or "\" separators. */
export function syntaxForPath(path: string): MarkdownSyntax | undefined {
  const lower = path.toLowerCase();
  const name = lower.slice(
    Math.max(lower.lastIndexOf("/"), lower.lastIndexOf("\\")) + 1,
  );
  if (name.endsWith(".mdx")) {
    return "mdx";
  }
  if (name.endsWith(".md")) {
    return "markdown";
  }
  return undefined;
}

export const MAX_TREE_DEPTH = 100;

export interface Frontmatter {
  readonly format: "yaml" | "toml";
  /** The text between the fences, as the parser gives it in the node's value. */
  readonly value: string;
  readonly position: Position;
}

export interface ParsedMarkdown {
  readonly kind: "parsed";
  readonly syntax: MarkdownSyntax;
  /** Positions point into `source`. */
  readonly tree: Root;
  /** The input text without a leading byte-order mark. */
  readonly source: string;
  readonly hasBom: boolean;
  /** The yaml or toml node when it is the first child of the root, otherwise undefined. */
  readonly frontmatter: Frontmatter | undefined;
}

export type MarkdownParseProblem = "invalid-mdx" | "too-deep";

export interface MarkdownParseFailure {
  readonly kind: "failed";
  readonly syntax: MarkdownSyntax;
  readonly problem: MarkdownParseProblem;
  /** Safe to print: control and bidi characters replaced, at most 200 characters. */
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
}

export type MarkdownParseResult = ParsedMarkdown | MarkdownParseFailure;

const BOM = "\uFEFF";
const MAX_MESSAGE_LENGTH = 200;
const TOO_DEEP_MESSAGE = `The document is nested too deeply to read (more than ${String(MAX_TREE_DEPTH)} levels).`;

// Built once. `.md` must never get remark-mdx: MDX is strict and would reject
// ordinary Markdown such as HTML comments.
const markdownProcessor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ["yaml", "toml"])
  .use(remarkGfm)
  .use(remarkDirective)
  .freeze();

const mdxProcessor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ["yaml", "toml"])
  .use(remarkGfm)
  .use(remarkDirective)
  .use(remarkMdx)
  .freeze();

function processorFor(syntax: MarkdownSyntax): typeof markdownProcessor {
  return syntax === "mdx" ? mdxProcessor : markdownProcessor;
}

function failure(
  syntax: MarkdownSyntax,
  problem: MarkdownParseProblem,
  message: string,
  line?: number,
  column?: number,
): MarkdownParseFailure {
  return {
    kind: "failed",
    syntax,
    problem,
    message,
    ...(line === undefined ? {} : { line }),
    ...(column === undefined ? {} : { column }),
  };
}

function tooDeep(syntax: MarkdownSyntax): MarkdownParseFailure {
  return failure(syntax, "too-deep", TOO_DEEP_MESSAGE);
}

/** The parser reports a bad MDX document by throwing a VFileMessage. */
interface MdxError extends Error {
  readonly reason: string;
}

function isMdxError(error: unknown): error is MdxError {
  return (
    error instanceof Error &&
    "reason" in error &&
    typeof error.reason === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

interface LineColumn {
  readonly line: number;
  readonly column: number;
}

function toLineColumn(value: unknown): LineColumn | undefined {
  if (
    isRecord(value) &&
    typeof value["line"] === "number" &&
    typeof value["column"] === "number"
  ) {
    return { line: value["line"], column: value["column"] };
  }
  return undefined;
}

// An unclosed block tag such as `<div>` gives no line, column or place; the
// location is only at the end of the reason, as in "... `<div>` (3:1-3:6)".
// Anchored, with bounded digit runs, so it stays fast on any reason text.
const REASON_LOCATION = /\((\d{1,9}):(\d{1,9})-\d{1,9}:\d{1,9}\)$/;

function locationInReason(reason: string): LineColumn | undefined {
  const match = REASON_LOCATION.exec(reason);
  if (match?.[1] === undefined || match[2] === undefined) {
    return undefined;
  }
  return { line: Number(match[1]), column: Number(match[2]) };
}

/**
 * Line and column from `line`/`column`, else `place.start`, else `place`,
 * else the end of the reason text.
 */
function mdxErrorLocation(error: MdxError): LineColumn | undefined {
  const direct = toLineColumn(error);
  if (direct !== undefined) {
    return direct;
  }
  const place: unknown = "place" in error ? error.place : undefined;
  if (isRecord(place)) {
    const fromPlace = toLineColumn(place["start"]) ?? toLineColumn(place);
    if (fromPlace !== undefined) {
      return fromPlace;
    }
  }
  return locationInReason(error.reason);
}

function mdxFailure(error: MdxError): MarkdownParseFailure {
  const location = mdxErrorLocation(error);
  return failure(
    "mdx",
    "invalid-mdx",
    toSafeText(error.reason, { maxLength: MAX_MESSAGE_LENGTH }),
    location?.line,
    location?.column,
  );
}

/**
 * Very deep nesting (about 8,000 block quotes) overflows the stack inside the
 * parser, which throws a RangeError. Micromark accepts any Markdown text, so
 * in Markdown mode nothing else is caught: anything else is a real bug.
 */
function parseSafely(
  source: string,
  syntax: MarkdownSyntax,
): Root | MarkdownParseFailure {
  try {
    return processorFor(syntax).parse(source);
  } catch (error) {
    if (error instanceof RangeError) {
      return tooDeep(syntax);
    }
    if (syntax === "mdx" && isMdxError(error)) {
      return mdxFailure(error);
    }
    throw error;
  }
}

/**
 * Later code walks the tree recursively, and trees can be deep without
 * crashing the parser (5,000 `*` around a word gives depth about 2,500). This
 * walk uses an explicit stack so it cannot overflow itself.
 */
function exceedsMaxDepth(root: Root): boolean {
  const stack: { node: Root | RootContent; depth: number }[] = [
    { node: root, depth: 0 },
  ];
  for (let entry = stack.pop(); entry !== undefined; entry = stack.pop()) {
    if (entry.depth > MAX_TREE_DEPTH) {
      return true;
    }
    if ("children" in entry.node) {
      for (const child of entry.node.children) {
        stack.push({ node: child, depth: entry.depth + 1 });
      }
    }
  }
  return false;
}

function sourceTextOf(
  node: { readonly position?: Position | undefined },
  source: string,
): string {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) {
    throw new Error("The parser gave a node without source offsets");
  }
  return source.slice(start, end);
}

/**
 * remark-directive turns ordinary prose such as `key:value`, `10:30` or `a:b`
 * into directives. Tulis only wants container directives (`:::note`), so the
 * text and leaf kinds go back to the exact text that was written.
 */
function restoreProseDirectives(tree: Root, source: string): void {
  visit(tree, (node, index, parent) => {
    if (parent === undefined || index === undefined) {
      return undefined;
    }
    if (node.type === "textDirective") {
      parent.children[index] = {
        type: "text",
        value: sourceTextOf(node, source),
        ...(node.position ? { position: node.position } : {}),
      };
      return SKIP;
    }
    if (node.type === "leafDirective") {
      parent.children[index] = {
        type: "paragraph",
        children: [
          {
            type: "text",
            value: sourceTextOf(node, source),
            ...(node.position ? { position: node.position } : {}),
          },
        ],
        ...(node.position ? { position: node.position } : {}),
      };
      return SKIP;
    }
    return undefined;
  });
}

function mergeTextRuns(children: RootContent[]): void {
  let i = 0;
  while (i < children.length - 1) {
    const current = children[i];
    const next = children[i + 1];
    if (current?.type === "text" && next?.type === "text") {
      current.value += next.value;
      if (current.position && next.position) {
        current.position = {
          start: current.position.start,
          end: next.position.end,
        };
      }
      children.splice(i + 1, 1);
    } else {
      i++;
    }
  }
}

/** Restoring directives leaves several text nodes side by side; join them. */
function mergeAdjacentText(tree: Root): void {
  visit(tree, (node: Root | RootContent) => {
    if ("children" in node) {
      mergeTextRuns(node.children);
    }
  });
}

function findFrontmatter(tree: Root): Frontmatter | undefined {
  const first = tree.children[0];
  if (first === undefined || !first.position) {
    return undefined;
  }
  // mdast's types know `yaml` but not `toml`, though the parser makes both.
  const type: string = first.type;
  if ((type !== "yaml" && type !== "toml") || !("value" in first)) {
    return undefined;
  }
  return { format: type, value: first.value, position: first.position };
}

/** Parses a doc into an mdast tree with exact positions into `result.source`. */
export function parseMarkdown(
  text: string,
  syntax: MarkdownSyntax,
): MarkdownParseResult {
  // The parser drops a leading BOM, which would shift every offset by one.
  const hasBom = text.startsWith(BOM);
  const source = hasBom ? text.slice(BOM.length) : text;

  const parsed = parseSafely(source, syntax);
  if ("kind" in parsed) {
    return parsed;
  }
  if (exceedsMaxDepth(parsed)) {
    return tooDeep(syntax);
  }

  restoreProseDirectives(parsed, source);
  mergeAdjacentText(parsed);
  return {
    kind: "parsed",
    syntax,
    tree: parsed,
    source,
    hasBom,
    frontmatter: findFrontmatter(parsed),
  };
}
