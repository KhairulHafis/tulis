import { isIgnored, nodeRange } from "../extract/tree-walk.js";
import type { SourceRange } from "../markdown/ignored-ranges.js";
import type { PreparedDoc } from "../prepare/prepare-doc.js";

export type HeadingSkipValue = "none" | "jump";

/** Whether heading levels ever jump (for example H2 to H4); one result per doc. */
export function findHeadingSkip(
  doc: PreparedDoc,
):
  | { readonly value: HeadingSkipValue; readonly range: SourceRange }
  | undefined {
  const title = doc.title;
  let previous: number | undefined = title === undefined ? undefined : 1;
  let first: SourceRange | undefined;
  for (const block of doc.blocks) {
    const node = block.node;
    if (node.type !== "heading") {
      continue;
    }
    if (
      title?.from === "h1" &&
      node.depth === 1 &&
      node.position?.start.line === title.line
    ) {
      continue;
    }
    const range = nodeRange(node);
    if (range === undefined || isIgnored(doc, range)) {
      continue;
    }
    if (previous !== undefined) {
      if (node.depth > previous + 1) {
        return { value: "jump", range };
      }
      first ??= range;
    }
    previous = node.depth;
  }
  return first === undefined ? undefined : { value: "none", range: first };
}
