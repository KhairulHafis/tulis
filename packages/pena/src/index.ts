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
  GitCommandError,
} from "./git/git-runner.js";
export type {
  GitCommand,
  GitRunOptions,
  GitStartOptions,
  GitRunner,
  GitProcess,
  GitExit,
  GitFailure,
} from "./git/git-runner.js";
export {
  isValidBranchName,
  checkBranchName,
  isObjectId,
} from "./git/ref-name.js";
export {
  resolveProdRef,
  prodRefCandidates,
  NoProdRefError,
  PROD_REMOTE,
} from "./git/prod-ref.js";
export type { ProdRef, ProdRefSource } from "./git/prod-ref.js";
export { listTree, parseLsTree, isSafeTreePath } from "./git/list-tree.js";
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
} from "./git/list-tree.js";
