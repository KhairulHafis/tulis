import { readFileSync, statSync } from "node:fs";

export interface Corpus {
  /** Folder name in the cache. */
  readonly name: string;
  /** HTTPS clone URL. */
  readonly url: string;
  /** The corpus's production branch. */
  readonly branch: string;
  /** Full 40-character lowercase commit hash. */
  readonly commit: string;
  /** POSIX path of the docs folder, relative to the repo root. */
  readonly docsPath: string;
}

export const MAX_CORPUS_LIST_BYTES = 64 * 1024;

const KEYS = ["name", "url", "branch", "commit", "docsPath"] as const;

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SEGMENT_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateName(value: string): string | undefined {
  if (value.length > 64 || !NAME_PATTERN.test(value)) {
    return '"name" must be 1 to 64 characters: lowercase letters, digits and hyphens, starting with a letter or digit';
  }
  return undefined;
}

function validateUrl(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return '"url" must be a valid URL';
  }
  if (url.protocol !== "https:") {
    return '"url" must use https';
  }
  if (url.username !== "" || url.password !== "") {
    return '"url" must not contain a username or password';
  }
  if (url.search !== "" || value.includes("?")) {
    return '"url" must not contain a query string';
  }
  if (url.hash !== "" || value.includes("#")) {
    return '"url" must not contain a fragment';
  }
  return undefined;
}

function validateBranch(value: string): string | undefined {
  if (
    value.length > 100 ||
    !BRANCH_PATTERN.test(value) ||
    value.includes("..") ||
    value.endsWith(".lock") ||
    value.endsWith(".")
  ) {
    return '"branch" must be a safe branch name (at most 100 characters, no "..", not ending in ".lock" or ".")';
  }
  return undefined;
}

function validateCommit(value: string): string | undefined {
  if (!COMMIT_PATTERN.test(value)) {
    return '"commit" must be a full 40-character lowercase commit hash';
  }
  return undefined;
}

function validateDocsPath(value: string): string | undefined {
  if (
    value.length > 200 ||
    !value.split("/").every((segment) => SEGMENT_PATTERN.test(segment))
  ) {
    return '"docsPath" must be a relative POSIX path of at most 200 characters whose segments start with a letter, digit or underscore';
  }
  return undefined;
}

function readString(
  entry: Record<string, unknown>,
  key: (typeof KEYS)[number],
  label: string,
): string {
  if (!(key in entry)) {
    throw new Error(`${label}: missing key "${key}"`);
  }
  const value = entry[key];
  if (typeof value !== "string") {
    throw new Error(`${label}: "${key}" must be a string`);
  }
  return value;
}

function validateEntry(
  entry: unknown,
  position: number,
  seenNames: Set<string>,
): Corpus {
  const label = `Corpus list entry ${String(position)}`;
  if (!isRecord(entry)) {
    throw new Error(`${label}: must be an object`);
  }
  const named =
    typeof entry["name"] === "string"
      ? `${label} ("${entry["name"].slice(0, 64)}")`
      : label;

  for (const key of Object.keys(entry)) {
    if (!(KEYS as readonly string[]).includes(key)) {
      throw new Error(`${named}: unknown key "${key.slice(0, 64)}"`);
    }
  }
  const name = readString(entry, "name", named);
  const url = readString(entry, "url", named);
  const branch = readString(entry, "branch", named);
  const commit = readString(entry, "commit", named);
  const docsPath = readString(entry, "docsPath", named);

  const problem =
    validateName(name) ??
    validateUrl(url) ??
    validateBranch(branch) ??
    validateCommit(commit) ??
    validateDocsPath(docsPath);
  if (problem !== undefined) {
    throw new Error(`${named}: ${problem}`);
  }
  if (seenNames.has(name)) {
    throw new Error(`${named}: "name" must be unique, it is used twice`);
  }
  seenNames.add(name);

  return Object.freeze({ name, url, branch, commit, docsPath });
}

/** Parses and validates the JSON text of a corpus list. */
export function parseCorpusList(text: string): Corpus[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Corpus list is not valid JSON");
  }
  if (!isRecord(data)) {
    throw new Error("Corpus list must be an object with a corpora array");
  }
  const topKeys = Object.keys(data);
  for (const key of topKeys) {
    if (key !== "corpora") {
      throw new Error(
        `Corpus list: unknown top-level key "${key.slice(0, 64)}"`,
      );
    }
  }
  if (!("corpora" in data)) {
    throw new Error('Corpus list: missing key "corpora"');
  }
  const list = data["corpora"];
  if (!Array.isArray(list)) {
    throw new Error('Corpus list: "corpora" must be an array');
  }
  if (list.length === 0) {
    throw new Error('Corpus list: "corpora" must not be empty');
  }
  const seenNames = new Set<string>();
  const entries: unknown[] = list;
  return entries.map((entry, index) =>
    validateEntry(entry, index + 1, seenNames),
  );
}

/** Reads and validates a corpus list file. */
export function loadCorpusList(filePath: string): Corpus[] {
  const size = statSync(filePath).size;
  if (size > MAX_CORPUS_LIST_BYTES) {
    throw new Error(
      `Corpus list ${filePath} is larger than ${String(MAX_CORPUS_LIST_BYTES)} bytes`,
    );
  }
  const text = readFileSync(filePath, "utf8");
  try {
    return parseCorpusList(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    throw new Error(`${filePath}: ${message}`, { cause: error });
  }
}
