// Placeholder that proves the package wiring, to be replaced by real code.
export const engineName = "Pena";

export {
  findGit,
  resolveGitPath,
  parseGitVersion,
  isSupportedGitVersion,
  GitSetupError,
  MIN_GIT_VERSION,
} from "./git/find-git.js";
export type {
  GitExecutable,
  GitVersion,
  GitSetupProblem,
  FindGitOptions,
} from "./git/find-git.js";
export {
  createGitRunner,
  buildGitArgs,
  isGitCommand,
  GIT_COMMANDS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_OUTPUT_BYTES,
  GIT_CONFIG_QUERIES,
  GitCommandError,
  isNotFoundExit,
} from "./git/git-runner.js";
export type {
  GitCommand,
  GitRunOptions,
  GitStartOptions,
  GitRunner,
  GitProcess,
  GitExit,
  GitFailure,
  GitConfigQuery,
} from "./git/git-runner.js";
export {
  isValidBranchName,
  checkBranchName,
  isObjectId,
  checkObjectId,
  parseSingleCommitId,
} from "./git/ref-name.js";
export {
  resolveProdRef,
  prodRefCandidates,
  NoProdRefError,
  PROD_REMOTE,
} from "./git/prod-ref.js";
export type { ProdRef, ProdRefSource } from "./git/prod-ref.js";
export {
  listTree,
  parseLsTree,
  parseLsTreeRecords,
  isSafeTreePath,
} from "./git/list-tree.js";
export {
  openBlobReader,
  DEFAULT_MAX_BLOB_BYTES,
  DEFAULT_READ_TIMEOUT_MS,
} from "./git/blob-reader.js";
export type {
  BlobReader,
  BlobReaderOptions,
  BlobResult,
} from "./git/blob-reader.js";
export type {
  TreeListing,
  TreeFile,
  SkippedTreeEntry,
  SkipReason,
  LsTreeRecord,
} from "./git/list-tree.js";
export { classifyTreeMode, TREE_ENTRY_OBJECT_TYPE } from "./git/tree-entry.js";
export type { TreeEntryKind } from "./git/tree-entry.js";
export { diffTrees, parseDiffTree } from "./git/diff-tree.js";
export type { TreeDiff, TreeChange, TreeChangeKind } from "./git/diff-tree.js";
export { resolveHead, findMergeBase } from "./git/merge-base.js";
export type { MergeBaseResult } from "./git/merge-base.js";
export { readFileAtCommit } from "./git/read-at-commit.js";
export type { FileAtCommit } from "./git/read-at-commit.js";
export {
  detectCloneKind,
  isShallowRepository,
  isPartialClone,
  parsePromisorRemotes,
} from "./git/clone-kind.js";
export type { CloneKind } from "./git/clone-kind.js";
export {
  loadConfig,
  formatIssue,
  ConfigError,
  CONFIG_FILE,
  MAX_CONFIG_BYTES,
} from "./config/load-config.js";
export type { LoadedConfig } from "./config/load-config.js";
export { checkConfig, MAX_ISSUES } from "./config/check-config.js";
export type { ConfigCheckResult } from "./config/check-config.js";
export {
  parseYaml,
  parseYamlDocument,
  serializeYamlDocument,
  YamlParseError,
  DEFAULT_MAX_YAML_BYTES,
  DEFAULT_MAX_YAML_ALIASES,
  DEFAULT_MAX_YAML_DEPTH,
} from "./config/parse-yaml.js";
export type {
  LineEnding,
  ParsedYaml,
  ParsedYamlDocument,
  ParseYamlOptions,
  SerializeYamlOptions,
  YamlPath,
} from "./config/parse-yaml.js";
export {
  DEFAULT_CONFIG,
  DEFAULT_EXCLUDES,
  LANGUAGE_CODES,
  effectiveExcludes,
} from "./config/config-defaults.js";
export {
  parseFileSize,
  KILOBYTE,
  MEGABYTE,
  MIN_MAX_FILE_SIZE,
  MAX_MAX_FILE_SIZE,
  DEFAULT_MAX_FILE_SIZE,
} from "./config/file-size.js";
export { CONFIG_FORMAT_VERSION } from "./config/config-types.js";
export { formatTeamIssue, TeamFileUseError } from "./config/team-issue.js";
export type { TeamIssue } from "./config/team-issue.js";
export {
  readFileVersion,
  MISSING_VERSION_MESSAGE,
  INVALID_VERSION_MESSAGE,
  newerVersionMessage,
} from "./config/file-version.js";
export type { FileVersion } from "./config/file-version.js";
export type {
  TulisConfig,
  DocTypesConfig,
  DocTypeRule,
  TuningConfig,
  ConfidenceWeights,
  ConfigIssue,
  ConfigPath,
  LineLookup,
} from "./config/config-types.js";
export {
  TULIS_FOLDER,
  TeamFileError,
  readTeamFile,
  listTeamFiles,
  writeTeamFile,
} from "./config/team-file.js";
export type {
  TeamPath,
  TeamFileRead,
  WriteTeamFileOptions,
} from "./config/team-file.js";
export {
  VARIANTS_FORMAT_VERSION,
  EMPTY_TEAM_VARIANTS,
} from "./config/variants-types.js";
export type {
  VariantSource,
  SynonymGroup,
  VerbNounGroup,
  VariantGroup,
  RejectedGroup,
  TeamVariants,
} from "./config/variants-types.js";
export { checkVariants, rejectedKey } from "./config/check-variants.js";
export type { VariantsCheckResult } from "./config/check-variants.js";
export {
  VARIANTS_FILE,
  MAX_VARIANTS_BYTES,
  readVariantsFile,
  loadVariants,
} from "./config/load-variants.js";
export type { LoadedVariants, VariantsFile } from "./config/load-variants.js";
export {
  decisionsFileName,
  isDecisionsFileName,
} from "./config/writer-file.js";
export {
  DECISIONS_FORMAT_VERSION,
  DECISIONS_FOLDER,
} from "./config/decisions-types.js";
export type { Dismissal, WriterDecisions } from "./config/decisions-types.js";
export { checkDecisions } from "./config/check-decisions.js";
export type { DecisionsCheckResult } from "./config/check-decisions.js";
export {
  loadDecisions,
  readDecisionsFile,
  DECISIONS_FILE_PREFIX,
  MAX_DECISIONS_BYTES,
  MAX_DECISIONS_FILES,
  MAX_DECISIONS_WARNINGS,
} from "./config/load-decisions.js";
export type {
  LoadedDecisions,
  DecisionsFile,
} from "./config/load-decisions.js";
export type { TeamFileEditOutcome } from "./config/edit-team-file.js";
export { addConfirmedGroup, addRejectedGroup } from "./config/edit-variants.js";
export type { ConfirmedGroup } from "./config/edit-variants.js";
export { recordDismissal } from "./config/edit-decisions.js";
export { prepareDoc } from "./prepare/prepare-doc.js";
export type {
  PrepareOptions,
  PreparedSentence,
  PreparedBlock,
  PreparedTitle,
  PrepareWarning,
  PreparedDoc,
  SkippedDoc,
  PrepareResult,
} from "./prepare/prepare-doc.js";
export type { PrepareSkipReason } from "./prepare/prepare-doc.js";
export {
  createDocPreparer,
  PREPARE_TIME_LIMIT_MS,
} from "./prepare/doc-preparer.js";
export type {
  DocPreparer,
  DocPreparerOptions,
} from "./prepare/doc-preparer.js";
export { sentenceTags } from "./prepare/sentence-tags.js";
export { syntaxForPath } from "./markdown/parse-markdown.js";
export type {
  MarkdownSyntax,
  ParsedMarkdown,
  Frontmatter,
} from "./markdown/parse-markdown.js";
export { createProductNameMatcher } from "./markdown/product-names.js";
export type { ProductNameMatcher } from "./markdown/product-names.js";
export {
  LANGUAGE_FIELDS,
  MAX_FRONTMATTER_BYTES,
  MAX_FRONTMATTER_FIELDS,
  MAX_FRONTMATTER_VALUE_LENGTH,
} from "./markdown/frontmatter-data.js";
export type {
  FrontmatterData,
  FrontmatterWarning,
  FrontmatterWarningCode,
} from "./markdown/frontmatter-data.js";
export type {
  MaskedText,
  MaskedSegment,
  Placeholder,
  PlaceholderKind,
} from "./markdown/masked-text.js";
export type {
  SourceRange,
  IgnoredRange,
  IgnoreWarning,
  IgnoreWarningCode,
} from "./markdown/ignored-ranges.js";
export type { LineColumn } from "./markdown/source-lines.js";
export type { ProseUnitKind } from "./markdown/prose-units.js";
export type { MaskableBlock } from "./markdown/mask-block.js";
export type { Token, TokenKind } from "./language/tokens.js";
export type {
  TaggedToken,
  PartOfSpeech,
  VerbForm,
} from "./language/tag-tokens.js";
export {
  MAX_OBSERVATION_VALUE_LENGTH,
  MAX_EVIDENCE_LENGTH,
  MAX_OBSERVATIONS_PER_EXTRACTOR,
} from "./extract/observation.js";
export type { Finding, Observation } from "./extract/observation.js";
export type {
  ExtractorScope,
  BlockContext,
  SentenceContext,
  DocumentExtractor,
  BlockExtractor,
  SentenceExtractor,
  Extractor,
} from "./extract/extractor.js";
export {
  createExtractorRegistry,
  ExtractorRegistryError,
} from "./extract/registry.js";
export type { ExtractorRegistry } from "./extract/registry.js";
export { runExtractors } from "./extract/run-extractors.js";
export type {
  ExtractionProblemKind,
  ExtractionProblem,
  ExtractionResult,
} from "./extract/run-extractors.js";
export { compileGlob, findGlobProblem, GlobError } from "./globs/glob.js";
export type { CompiledGlob, GlobProblem } from "./globs/glob.js";
export { isDocTypeName } from "./doc-types/doc-type-name.js";
export { createDocTypeResolver } from "./doc-types/resolve-doc-type.js";
export type { DocType, DocTypeResolver } from "./doc-types/resolve-doc-type.js";
export {
  parseSeedGroups,
  loadSeedGroups,
  SeedListError,
} from "./terms/seed-groups.js";
export { resolveVariantGroups } from "./terms/resolve-groups.js";
export type { ResolvedGroups } from "./terms/resolve-groups.js";
export { termKey } from "./terms/term-key.js";
export { inflectedForms } from "./terms/word-forms.js";
export { createTermMatcher } from "./terms/term-matcher.js";
export type {
  TermEntry,
  TermMatch,
  TermMatcher,
} from "./terms/term-matcher.js";
export { createSynonymExtractor } from "./terms/synonym-extractor.js";
export { createVerbNounExtractor } from "./terms/verb-noun-extractor.js";
export { termRole } from "./terms/verb-noun-role.js";
export type { TermRole } from "./terms/verb-noun-role.js";
export { findPurposeClause } from "./phrasing/purpose-clause.js";
export type {
  PurposeClause,
  PurposePosition,
} from "./phrasing/purpose-clause.js";
export { createPurposeClauseExtractor } from "./phrasing/purpose-clause-extractor.js";
export { headingCase } from "./headings/heading-case.js";
export type { HeadingCase } from "./headings/heading-case.js";
export { headingEndPunct } from "./headings/heading-end-punct.js";
export type { HeadingEndPunct } from "./headings/heading-end-punct.js";
export { createHeadingCaseExtractor } from "./headings/heading-case-extractor.js";
export type { HeadingCaseOptions } from "./headings/heading-case-extractor.js";
export {
  MAX_DOC_WORD_KEYS,
  MAX_TOTAL_WORD_KEYS,
  MAX_PROPER_NOUNS,
  MAX_PROPER_NOUN_KEY_LENGTH,
  PROPER_NOUN_MIN_USES,
  PROPER_NOUN_MIN_SHARE,
  PROPER_NOUN_MIN_DOCS,
  properNounKey,
  countWordCase,
  sumWordCase,
  learnProperNouns,
} from "./headings/proper-nouns.js";
export type { WordCaseCount, WordCaseTotal } from "./headings/proper-nouns.js";
export { createHeadingEndPunctExtractor } from "./headings/heading-end-punct-extractor.js";
export { findProcedures } from "./procedures/procedure-lists.js";
export type { Procedure, ProcedureStep } from "./procedures/procedure-lists.js";
export { stepStart } from "./procedures/step-start.js";
export type { StepStart } from "./procedures/step-start.js";
export { procedureNumbering } from "./procedures/numbering.js";
export type { ProcedureNumbering } from "./procedures/numbering.js";
export { stepEndPunct } from "./procedures/step-end-punct.js";
export type { StepEndPunct } from "./procedures/step-end-punct.js";
export { procedureIntro } from "./procedures/procedure-intro.js";
export type { ProcedureIntro } from "./procedures/procedure-intro.js";
export { createProcedureNumberingExtractor } from "./procedures/procedure-numbering-extractor.js";
export { createStepStartExtractor } from "./procedures/step-start-extractor.js";
export { createStepEndPunctExtractor } from "./procedures/step-end-punct-extractor.js";
export { createProcedureIntroExtractor } from "./procedures/procedure-intro-extractor.js";
export { createBuiltInExtractors } from "./extract/built-in-extractors.js";
export type { BuiltInExtractorOptions } from "./extract/built-in-extractors.js";
export { findAdmonitions } from "./admonitions/find-admonitions.js";
export type {
  Admonition,
  AdmonitionSyntax,
  AdmonitionLabel,
} from "./admonitions/find-admonitions.js";
export type { AdmonitionLabelFormat } from "./admonitions/label-format.js";
export { labelFormat } from "./admonitions/label-format.js";
export { createAdmonitionSyntaxExtractor } from "./admonitions/admonition-syntax-extractor.js";
export { createAdmonitionLabelFormatExtractor } from "./admonitions/admonition-label-format-extractor.js";
export { findCodeBlocks, codeFence } from "./code-blocks/find-code-blocks.js";
export type { CodeBlock, CodeFence } from "./code-blocks/find-code-blocks.js";
export {
  LANGUAGE_GROUPS,
  languageGroup,
} from "./code-blocks/language-groups.js";
export type { LanguageGroup } from "./code-blocks/language-groups.js";
export { shellPrompt } from "./code-blocks/shell-prompt.js";
export type { ShellPrompt } from "./code-blocks/shell-prompt.js";
export { createCodeFenceExtractor } from "./code-blocks/code-fence-extractor.js";
export { createCodeLangTagExtractor } from "./code-blocks/code-lang-tag-extractor.js";
export { createCodeLangNameExtractor } from "./code-blocks/code-lang-name-extractor.js";
export { createCodeShellPromptExtractor } from "./code-blocks/code-shell-prompt-extractor.js";
