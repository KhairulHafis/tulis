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
  GitRunner,
  GitFailure,
} from "./git/git-runner.js";
export {
  isValidBranchName,
  checkBranchName,
  isObjectId,
} from "./git/ref-name.js";
