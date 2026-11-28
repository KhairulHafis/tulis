import type { DocumentExtractor } from "../extract/extractor.js";
import type { Finding } from "../extract/observation.js";
import { findAdmonitions } from "./find-admonitions.js";

/** `admonition.syntax`: the syntax of each admonition, over its whole range. */
export function createAdmonitionSyntaxExtractor(): DocumentExtractor {
  return {
    id: "admonition.syntax",
    scope: "document",
    extract(doc): readonly Finding[] {
      return findAdmonitions(doc).map((admonition) => ({
        dimension: "admonition.syntax",
        value: admonition.syntax,
        range: admonition.range,
      }));
    },
  };
}
