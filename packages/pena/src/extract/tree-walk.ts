import type { Parent, Root, RootContent } from "mdast";
import type { SourceRange } from "../markdown/ignored-ranges.js";
import { RangeIndex } from "../markdown/range-index.js";
import type { PreparedDoc } from "../prepare/prepare-doc.js";

export type WalkAction = "skip-children" | undefined;

/**
 * Visits every node of doc.parsed.tree in document order (pre-order), iteratively.
 * Never enters mdxJsxFlowElement or mdxJsxTextElement nodes (they are not visited either).
 * Returning "skip-children" from visit stops the walk going into that node's children.
 */
export function walkTree(
  doc: PreparedDoc,
  visit: (node: Root | RootContent, parent: Parent | undefined) => WalkAction,
): void {
  const stack: { node: Root | RootContent; parent: Parent | undefined }[] = [
    { node: doc.parsed.tree, parent: undefined },
  ];
  for (;;) {
    const item = stack.pop();
    if (item === undefined) {
      return;
    }
    const { node, parent } = item;
    const type: string = node.type;
    if (type === "mdxJsxFlowElement" || type === "mdxJsxTextElement") {
      continue;
    }
    if (visit(node, parent) === "skip-children" || !("children" in node)) {
      continue;
    }
    for (let i = node.children.length - 1; i >= 0; i -= 1) {
      const child = node.children[i];
      if (child !== undefined) {
        stack.push({ node: child, parent: node });
      }
    }
  }
}

const ignoreIndexes = new WeakMap<PreparedDoc, RangeIndex>();

/** True when range overlaps one of doc.ignoredRanges (end exclusive). Cached per doc in a WeakMap. */
export function isIgnored(doc: PreparedDoc, range: SourceRange): boolean {
  let index = ignoreIndexes.get(doc);
  if (index === undefined) {
    index = new RangeIndex(doc.ignoredRanges);
    ignoreIndexes.set(doc, index);
  }
  return index.overlaps(range);
}

/** The node's source range from position offsets, or undefined when it has no position. */
export function nodeRange(node: Root | RootContent): SourceRange | undefined {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) {
    return undefined;
  }
  return { start, end };
}
