import { toSafeText } from "./safe-text.js";

const MAX_BRANCH_LENGTH = 255;
const FORBIDDEN_CHARS = new Set([" ", "~", "^", ":", "?", "*", "[", "\\"]);

function hasForbiddenChar(name: string): boolean {
  for (const char of name) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f || FORBIDDEN_CHARS.has(char)) {
      return true;
    }
  }
  return false;
}

/** True when `name` is a branch name Tulis accepts. */
export function isValidBranchName(name: string): boolean {
  if (name.length < 1 || name.length > MAX_BRANCH_LENGTH) return false;
  if (name.startsWith("-")) return false;
  if (name === "@" || name === "HEAD") return false;
  if (hasForbiddenChar(name)) return false;
  if (name.includes("..") || name.includes("@{")) return false;
  if (name.startsWith("/") || name.endsWith("/") || name.includes("//")) {
    return false;
  }
  if (name.endsWith(".")) return false;
  for (const part of name.split("/")) {
    if (part.startsWith(".") || part.endsWith(".lock")) return false;
  }
  return true;
}

/** Throws an Error `Invalid branch name "<safe name>"` unless isValidBranchName(name). */
export function checkBranchName(name: string): void {
  if (!isValidBranchName(name)) {
    throw new Error(`Invalid branch name "${toSafeText(name)}"`);
  }
}

/** True for a full commit or object ID: 40 (SHA-1) or 64 (SHA-256) lower-case hex characters. */
export function isObjectId(value: string): boolean {
  return /^[0-9a-f]{40}$/.test(value) || /^[0-9a-f]{64}$/.test(value);
}

/** Throws an Error `Not a full object ID: "<safe value>"` unless isObjectId(value). */
export function checkObjectId(value: string): void {
  if (!isObjectId(value)) {
    throw new Error(`Not a full object ID: "${toSafeText(value)}"`);
  }
}

/** The single full object ID in a git command's output (blank lines ignored). Throws Error `git <command> did not return a single commit ID` for anything else. */
export function parseSingleCommitId(output: string, command: string): string {
  const lines = output.split(/\r?\n/).filter((line) => line !== "");
  const commit = lines[0];
  if (lines.length !== 1 || commit === undefined || !isObjectId(commit)) {
    throw new Error(`git ${command} did not return a single commit ID`);
  }
  return commit;
}
