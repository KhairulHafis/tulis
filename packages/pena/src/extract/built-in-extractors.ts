import type { VariantGroup } from "../config/variants-types.js";
import { createSynonymExtractor } from "../terms/synonym-extractor.js";
import { createVerbNounExtractor } from "../terms/verb-noun-extractor.js";
import type { Extractor } from "./extractor.js";

export interface BuiltInExtractorOptions {
  /** Resolved variant groups (seeds merged with the team's file). */
  readonly groups: readonly VariantGroup[];
}

/** Every built-in extractor, in a fixed order. Later sessions add theirs here. */
export function createBuiltInExtractors(
  options: BuiltInExtractorOptions,
): readonly Extractor[] {
  return [
    createSynonymExtractor(options.groups),
    createVerbNounExtractor(options.groups),
  ];
}
