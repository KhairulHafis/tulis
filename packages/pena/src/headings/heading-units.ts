import type { Token } from "../language/tokens.js";
import type { SourceRange } from "../markdown/ignored-ranges.js";
import type { PreparedDoc } from "../prepare/prepare-doc.js";

/** Page titles (H1) and lower headings are counted apart. */
export type HeadingLevel = "h1" | "h2plus";

export interface HeadingUnit {
  readonly level: HeadingLevel;
  readonly tokens: readonly Token[];
  readonly range: SourceRange;
}

/** The frontmatter page title (as h1) when the doc has one, then every heading block with a sentence, in document order. */
export function headingUnits(doc: PreparedDoc): HeadingUnit[] {
  const units: HeadingUnit[] = [];
  if (doc.title?.from === "frontmatter") {
    units.push({
      level: "h1",
      tokens: doc.title.tokens,
      range: doc.title.range,
    });
  }
  for (const block of doc.blocks) {
    if (block.kind !== "heading" || block.node.type !== "heading") continue;
    const sentence = block.sentences[0];
    if (sentence === undefined) continue;
    units.push({
      level: block.node.depth === 1 ? "h1" : "h2plus",
      tokens: sentence.tokens,
      range: sentence.source,
    });
  }
  return units;
}
