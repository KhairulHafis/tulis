import type { VariantGroup } from "../config/variants-types.js";
import { createHeadingCaseExtractor } from "../headings/heading-case-extractor.js";
import { createHeadingEndPunctExtractor } from "../headings/heading-end-punct-extractor.js";
import { createPurposeClauseExtractor } from "../phrasing/purpose-clause-extractor.js";
import { createSynonymExtractor } from "../terms/synonym-extractor.js";
import { createVerbNounExtractor } from "../terms/verb-noun-extractor.js";
import type { Extractor } from "./extractor.js";

export interface BuiltInExtractorOptions {
  /** Resolved variant groups (seeds merged with the team's file). */
  readonly groups: readonly VariantGroup[];
  /** Learned proper-noun keys, so capitalised names don't signal title case. */
  readonly properNouns?: ReadonlySet<string>;
}

/** Every built-in extractor, in a fixed order. Later sessions add theirs here. */
export function createBuiltInExtractors(
  options: BuiltInExtractorOptions,
): readonly Extractor[] {
  return [
    createSynonymExtractor(options.groups),
    createVerbNounExtractor(options.groups),
    createPurposeClauseExtractor(),
    createHeadingCaseExtractor(
      options.properNouns === undefined
        ? {}
        : { properNouns: options.properNouns },
    ),
    createHeadingEndPunctExtractor(),
  ];
}
