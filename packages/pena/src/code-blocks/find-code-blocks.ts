import type { SourceRange } from "../markdown/ignored-ranges.js";
import { isIgnored, nodeRange, walkTree } from "../extract/tree-walk.js";
import type { PreparedDoc } from "../prepare/prepare-doc.js";

export type CodeFence = "backticks" | "tildes" | "indented";

export interface CodeBlock {
  readonly fence: CodeFence;
  /** node.lang as written; null, undefined and "" become undefined. */
  readonly lang: string | undefined;
  /** node.value, the content without the fences. */
  readonly value: string;
  readonly range: SourceRange;
}

/** Skips at most 3 spaces from offset, then looks for three backticks or tildes. */
export function codeFence(source: string, offset: number): CodeFence {
  let i = offset;
  while (i < offset + 3 && source[i] === " ") {
    i += 1;
  }
  const three = source.slice(i, i + 3);
  if (three === "```") return "backticks";
  if (three === "~~~") return "tildes";
  return "indented";
}

const cache = new WeakMap<PreparedDoc, readonly CodeBlock[]>();

function findUncached(doc: PreparedDoc): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  walkTree(doc, (node) => {
    if (node.type !== "code") {
      return undefined;
    }
    const range = nodeRange(node);
    if (range === undefined || isIgnored(doc, range)) {
      return undefined;
    }
    blocks.push({
      fence: codeFence(doc.parsed.source, range.start),
      lang:
        node.lang === null || node.lang === undefined || node.lang === ""
          ? undefined
          : node.lang,
      value: node.value,
      range,
    });
    return undefined;
  });
  return blocks;
}

/** The code blocks of a doc in document order, ignored ones dropped. Cached per doc. */
export function findCodeBlocks(doc: PreparedDoc): readonly CodeBlock[] {
  let found = cache.get(doc);
  if (found === undefined) {
    found = findUncached(doc);
    cache.set(doc, found);
  }
  return found;
}
