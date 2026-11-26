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
  YamlParseError,
  DEFAULT_MAX_YAML_BYTES,
  DEFAULT_MAX_YAML_ALIASES,
  DEFAULT_MAX_YAML_DEPTH,
} from "./config/parse-yaml.js";
export type {
  ParsedYaml,
  ParseYamlOptions,
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
