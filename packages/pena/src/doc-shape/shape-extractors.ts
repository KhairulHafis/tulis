import type { DocumentExtractor } from "../extract/extractor.js";
import type { Finding } from "../extract/observation.js";
import { isIgnored, nodeRange } from "../extract/tree-walk.js";
import { findHeadingSkip } from "./heading-skip.js";
import { findIntro } from "./intro.js";
import { sectionName } from "./section-name.js";

/** `shape.intro`: "yes" when the page opens with a paragraph after its title. */
export function createShapeIntroExtractor(): DocumentExtractor {
  return {
    id: "shape.intro",
    scope: "document",
    extract(doc): readonly Finding[] {
      const found = findIntro(doc);
      return found === undefined
        ? []
        : [{ dimension: "shape.intro", ...found }];
    },
  };
}

/** `shape.heading-skip`: "jump" when heading levels skip one, else "none". */
export function createShapeHeadingSkipExtractor(): DocumentExtractor {
  return {
    id: "shape.heading-skip",
    scope: "document",
    extract(doc): readonly Finding[] {
      const found = findHeadingSkip(doc);
      return found === undefined
        ? []
        : [{ dimension: "shape.heading-skip", ...found }];
    },
  };
}

/** `shape.sections`: the normalised name of every H2, in page order. */
export function createShapeSectionsExtractor(): DocumentExtractor {
  return {
    id: "shape.sections",
    scope: "document",
    extract(doc): readonly Finding[] {
      const findings: Finding[] = [];
      for (const block of doc.blocks) {
        if (block.node.type !== "heading" || block.node.depth !== 2) {
          continue;
        }
        const range = nodeRange(block.node);
        if (range === undefined || isIgnored(doc, range)) {
          continue;
        }
        const name = sectionName(block, doc.parsed.source);
        if (name !== undefined) {
          findings.push({ dimension: "shape.sections", value: name, range });
        }
      }
      return findings;
    },
  };
}
