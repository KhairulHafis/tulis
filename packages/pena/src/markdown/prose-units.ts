import type { Root, RootContent } from "mdast";
import {
  maskBlock,
  type MaskableBlock,
  type MaskOptions,
} from "./mask-block.js";
import { toSourceRange, type MaskedText } from "./masked-text.js";
import type { ParsedMarkdown } from "./parse-markdown.js";
import { splitSentences, type Sentence } from "./sentences.js";

export type ProseUnitKind = "paragraph" | "heading" | "tableCell";

export interface ProseUnit {
  readonly kind: ProseUnitKind;
  readonly block: MaskableBlock;
  readonly masked: MaskedText;
  readonly sentences: readonly Sentence[];
}

/** Node types whose children are searched for prose blocks. */
const CONTAINERS: ReadonlySet<string> = new Set([
  "root",
  "list",
  "listItem",
  "blockquote",
  "footnoteDefinition",
  "containerDirective",
  "table",
  "tableRow",
]);

function isBlock(node: Root | RootContent): node is MaskableBlock {
  return (
    node.type === "paragraph" ||
    node.type === "heading" ||
    node.type === "tableCell"
  );
}

/** Paragraphs, headings and table cells in document order. */
export function collectProseBlocks(tree: Root): MaskableBlock[] {
  const blocks: MaskableBlock[] = [];
  const stack: (Root | RootContent)[] = [tree];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (isBlock(node)) {
      blocks.push(node);
      continue;
    }
    const type: string = node.type;
    if (CONTAINERS.has(type) && "children" in node) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        const child = node.children[i];
        if (child !== undefined) {
          stack.push(child);
        }
      }
    }
  }
  return blocks;
}

function headingSentences(masked: MaskedText): Sentence[] {
  const text = masked.text;
  let start = 0;
  let end = text.length;
  while (start < end && /\s/u.test(text.charAt(start))) {
    start++;
  }
  while (end > start && /\s/u.test(text.charAt(end - 1))) {
    end--;
  }
  if (start >= end) {
    return [];
  }
  return [
    {
      text: text.slice(start, end),
      maskedStart: start,
      maskedEnd: end,
      source: toSourceRange(masked, start, end),
    },
  ];
}

export function proseUnit(
  block: MaskableBlock,
  parsed: ParsedMarkdown,
  options: MaskOptions = {},
): ProseUnit {
  const masked = maskBlock(block, parsed, options);
  const kind: ProseUnitKind = block.type;
  return {
    kind,
    block,
    masked,
    sentences:
      block.type === "heading"
        ? headingSentences(masked)
        : splitSentences(masked),
  };
}
