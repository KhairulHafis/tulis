import { createAdmonitionLabelFormatExtractor } from "../admonitions/admonition-label-format-extractor.js";
import { createAdmonitionSyntaxExtractor } from "../admonitions/admonition-syntax-extractor.js";
import { createCodeFenceExtractor } from "../code-blocks/code-fence-extractor.js";
import { createCodeLangNameExtractor } from "../code-blocks/code-lang-name-extractor.js";
import { createCodeLangTagExtractor } from "../code-blocks/code-lang-tag-extractor.js";
import { createCodeShellPromptExtractor } from "../code-blocks/code-shell-prompt-extractor.js";
import type { VariantGroup } from "../config/variants-types.js";
import { createHeadingCaseExtractor } from "../headings/heading-case-extractor.js";
import { createHeadingEndPunctExtractor } from "../headings/heading-end-punct-extractor.js";
import { createPurposeClauseExtractor } from "../phrasing/purpose-clause-extractor.js";
import { createProcedureIntroExtractor } from "../procedures/procedure-intro-extractor.js";
import { createProcedureNumberingExtractor } from "../procedures/procedure-numbering-extractor.js";
import { createStepEndPunctExtractor } from "../procedures/step-end-punct-extractor.js";
import { createStepStartExtractor } from "../procedures/step-start-extractor.js";
import {
  createShapeHeadingSkipExtractor,
  createShapeIntroExtractor,
  createShapeSectionsExtractor,
} from "../doc-shape/shape-extractors.js";
import { createSynonymExtractor } from "../terms/synonym-extractor.js";
import { createVerbNounExtractor } from "../terms/verb-noun-extractor.js";
import { createUiFormatExtractor } from "../ui-labels/ui-format-extractor.js";
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
    createProcedureNumberingExtractor(),
    createStepStartExtractor(),
    createStepEndPunctExtractor(),
    createProcedureIntroExtractor(),
    createAdmonitionSyntaxExtractor(),
    createAdmonitionLabelFormatExtractor(),
    createCodeFenceExtractor(),
    createCodeLangTagExtractor(),
    createCodeLangNameExtractor(),
    createCodeShellPromptExtractor(),
    createUiFormatExtractor(),
    createShapeIntroExtractor(),
    createShapeHeadingSkipExtractor(),
    createShapeSectionsExtractor(),
  ];
}
