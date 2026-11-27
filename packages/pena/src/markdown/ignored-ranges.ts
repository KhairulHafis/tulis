import type { Nodes, Parents } from "mdast";
import { visit } from "unist-util-visit";
import {
  htmlCommentBody,
  mdxCommentBody,
  readIgnoreComment,
  type IgnoreComment,
  type IgnoreCommentProblem,
} from "./ignore-comment.js";
import type { ParsedMarkdown } from "./parse-markdown.js";

export interface SourceRange {
  /** Offsets into ParsedMarkdown.source, end exclusive. */
  readonly start: number;
  readonly end: number;
}

export interface IgnoredRange extends SourceRange {
  readonly kind: "next" | "range";
  /** Empty means every check. */
  readonly checks: readonly string[];
  readonly reason: string | undefined;
  /** 1-based line of the comment that made this range (the start comment for "range"). */
  readonly line: number;
}

export type IgnoreWarningCode =
  | IgnoreCommentProblem
  | "inline-comment"
  | "not-alone"
  | "nothing-to-ignore"
  | "unclosed-start"
  | "stray-end";

export interface IgnoreWarning {
  readonly code: IgnoreWarningCode;
  /** 1-based, from the comment node's position.start. */
  readonly line: number;
  readonly column: number;
}

export interface IgnoreScan {
  readonly ignored: readonly IgnoredRange[];
  readonly htmlRanges: readonly SourceRange[];
  readonly warnings: readonly IgnoreWarning[];
  /** Warnings dropped after the first MAX_IGNORE_WARNINGS. */
  readonly moreWarnings: number;
}

export const MAX_IGNORE_WARNINGS = 100;

const BLOCK_CONTAINERS: ReadonlySet<string> = new Set([
  "root",
  "blockquote",
  "listItem",
  "footnoteDefinition",
  "containerDirective",
  "mdxJsxFlowElement",
]);

type NodeReading =
  | { readonly status: "none" }
  | { readonly status: "not-alone" }
  | { readonly status: "ignore"; readonly comment: IgnoreComment }
  | { readonly status: "malformed"; readonly problem: IgnoreCommentProblem };

const NONE: NodeReading = { status: "none" };

/** Reads a comment node's value; `body` is undefined when the value is not exactly one comment. */
function readValue(value: string, body: string | undefined): NodeReading {
  if (body === undefined) {
    return value.toLowerCase().includes("tulis-ignore")
      ? { status: "not-alone" }
      : NONE;
  }
  const reading = readIgnoreComment(body);
  if (reading.status === "ignore") {
    return { status: "ignore", comment: reading.comment };
  }
  if (reading.status === "malformed") {
    return { status: "malformed", problem: reading.problem };
  }
  return NONE;
}

/** Reads a node that could hold an ignore comment, in the given syntax. */
function readNode(node: Nodes): NodeReading {
  if (node.type === "html") {
    return readValue(node.value, htmlCommentBody(node.value));
  }
  if (node.type === "mdxFlowExpression" || node.type === "mdxTextExpression") {
    return readValue(node.value, mdxCommentBody(node.value));
  }
  return NONE;
}

/** True for a block-level comment that reads as a valid "next" comment. */
function isNextComment(node: Nodes): boolean {
  if (node.type !== "html" && node.type !== "mdxFlowExpression") {
    return false;
  }
  const reading = readNode(node);
  return reading.status === "ignore" && reading.comment.kind === "next";
}

interface OpenStart {
  readonly start: number;
  readonly commentOffset: number;
  readonly checks: readonly string[];
  readonly reason: string | undefined;
  readonly line: number;
  readonly column: number;
}

interface Ordered<T> {
  readonly order: number;
  readonly item: T;
}

interface RangeEntry {
  readonly commentOffset: number;
  readonly range: IgnoredRange;
}

/** Finds the ignore comments in a parsed document. See the module brief for the rules. */
export function findIgnoredRanges(parsed: ParsedMarkdown): IgnoreScan {
  const ignored: RangeEntry[] = [];
  const htmlRanges: SourceRange[] = [];
  const warnings: Ordered<IgnoreWarning>[] = [];
  const stack: OpenStart[] = [];
  // Index of the sibling a "next" comment applies to (undefined: none),
  // filled once per run of stacked comments so the scan stays linear.
  const targets = new Map<Nodes, number | undefined>();

  function warn(
    code: IgnoreWarningCode,
    order: number,
    line: number,
    column: number,
  ): void {
    warnings.push({ order, item: { code, line, column } });
  }

  function findTarget(
    parent: Parents,
    index: number,
    node: Nodes,
  ): number | undefined {
    if (targets.has(node)) {
      return targets.get(node);
    }
    const siblings: readonly Nodes[] = parent.children;
    let next = index + 1;
    for (;;) {
      const sibling = siblings[next];
      if (sibling === undefined || !isNextComment(sibling)) {
        break;
      }
      next += 1;
    }
    const target = next < siblings.length ? next : undefined;
    for (let i = index; i < next; i += 1) {
      const comment = siblings[i];
      if (comment !== undefined) {
        targets.set(comment, target);
      }
    }
    return target;
  }

  visit(parsed.tree, (node, index, parent) => {
    const position = node.position;
    if (position === undefined) {
      return;
    }
    const startOffset = position.start.offset;
    const endOffset = position.end.offset;
    if (startOffset === undefined || endOffset === undefined) {
      return;
    }
    const { line, column } = position.start;

    if (node.type === "html") {
      htmlRanges.push({ start: startOffset, end: endOffset });
    }
    if (
      node.type !== "html" &&
      node.type !== "mdxFlowExpression" &&
      node.type !== "mdxTextExpression"
    ) {
      return;
    }

    const reading = readNode(node);
    if (reading.status === "none") {
      return;
    }
    if (reading.status === "not-alone") {
      warn("not-alone", startOffset, line, column);
      return;
    }

    const isBlock =
      node.type === "mdxFlowExpression" ||
      (node.type === "html" &&
        parent !== undefined &&
        BLOCK_CONTAINERS.has(parent.type));
    if (!isBlock) {
      warn("inline-comment", startOffset, line, column);
      return;
    }
    if (reading.status === "malformed") {
      warn(reading.problem, startOffset, line, column);
      return;
    }

    const { comment } = reading;
    if (comment.kind === "next") {
      const targetIndex =
        parent !== undefined && index !== undefined
          ? findTarget(parent, index, node)
          : undefined;
      const target =
        parent !== undefined && targetIndex !== undefined
          ? parent.children[targetIndex]?.position
          : undefined;
      if (
        target?.start.offset === undefined ||
        target.end.offset === undefined
      ) {
        warn("nothing-to-ignore", startOffset, line, column);
        return;
      }
      ignored.push({
        commentOffset: startOffset,
        range: {
          kind: "next",
          start: target.start.offset,
          end: target.end.offset,
          checks: comment.checks,
          reason: comment.reason,
          line,
        },
      });
    } else if (comment.kind === "start") {
      stack.push({
        start: endOffset,
        commentOffset: startOffset,
        checks: comment.checks,
        reason: comment.reason,
        line,
        column,
      });
    } else {
      const open = stack.pop();
      if (open === undefined) {
        warn("stray-end", startOffset, line, column);
        return;
      }
      ignored.push({
        commentOffset: open.commentOffset,
        range: {
          kind: "range",
          start: open.start,
          end: startOffset,
          checks: open.checks,
          reason: open.reason,
          line: open.line,
        },
      });
    }
  });

  for (const open of stack) {
    warn("unclosed-start", open.commentOffset, open.line, open.column);
    ignored.push({
      commentOffset: open.commentOffset,
      range: {
        kind: "range",
        start: open.start,
        end: parsed.source.length,
        checks: open.checks,
        reason: open.reason,
        line: open.line,
      },
    });
  }

  ignored.sort(
    (a, b) =>
      a.range.start - b.range.start || a.commentOffset - b.commentOffset,
  );
  warnings.sort((a, b) => a.order - b.order);
  const kept = warnings.slice(0, MAX_IGNORE_WARNINGS);

  return {
    ignored: ignored.map((entry) => entry.range),
    htmlRanges,
    warnings: kept.map((entry) => entry.item),
    moreWarnings: warnings.length - kept.length,
  };
}
