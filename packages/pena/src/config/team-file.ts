import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

/** The folder inside a repo where Tulis keeps its team files. */
export const TULIS_FOLDER = ".tulis";

/** A file or folder path inside `.tulis/`, one name per element. */
export type TeamPath = readonly string[];

const MAX_NAME_LENGTH = 255;
const RENAME_RETRY_DELAYS_MS: readonly number[] = [50, 100, 200];

/** O_NONBLOCK does not exist on Windows. */
const optionalConstants: Partial<typeof constants> = constants;

/** Reading, listing or writing failed. `reason` is safe to show. */
export class TeamFileError extends Error {
  readonly reason: string;

  constructor(reason: string, options?: { readonly cause?: unknown }) {
    super(reason, options);
    this.name = "TeamFileError";
    this.reason = reason;
  }
}

export type TeamFileRead =
  | { readonly kind: "missing" }
  | { readonly kind: "text"; readonly text: string };

function errorCode(error: unknown): unknown {
  return error instanceof Error && "code" in error ? error.code : undefined;
}

function isMissingCode(code: unknown): boolean {
  return code === "ENOENT" || code === "ENOTDIR";
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return (
    rel !== "" &&
    !isAbsolute(rel) &&
    rel !== ".." &&
    !rel.startsWith(`..${sep}`)
  );
}

function hasControlCharacter(name: string): boolean {
  for (let i = 0; i < name.length; i += 1) {
    const code = name.charCodeAt(i);
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      return true;
    }
  }
  return false;
}

function isValidName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= MAX_NAME_LENGTH &&
    name !== "." &&
    name !== ".." &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !hasControlCharacter(name)
  );
}

function checkNames(path: TeamPath): void {
  for (const name of path) {
    if (!isValidName(name)) {
      throw new TeamFileError("The file name is not allowed.");
    }
  }
}

function sizeText(maxBytes: number): string {
  return maxBytes % 1024 === 0
    ? `${String(maxBytes / 1024)} KB`
    : `${String(maxBytes)} bytes`;
}

async function resolveRoot(repoRoot: string): Promise<string> {
  try {
    return await realpath(repoRoot);
  } catch {
    throw new TeamFileError("The repository folder could not be opened.");
  }
}

/** Reads at most maxBytes + 1 bytes, so the caller can tell "too big". */
async function readCapped(realFile: string, maxBytes: number): Promise<Buffer> {
  const tooBig = `The file is larger than ${sizeText(maxBytes)}.`;
  const handle = await open(
    realFile,
    constants.O_RDONLY | (optionalConstants.O_NONBLOCK ?? 0),
  );
  try {
    const info = await handle.stat();
    if (!info.isFile()) {
      throw new TeamFileError("The file is not a regular file.");
    }
    if (info.size > maxBytes) {
      throw new TeamFileError(tooBig);
    }
    const cap = maxBytes + 1;
    const buffer = Buffer.alloc(cap);
    let total = 0;
    while (total < cap) {
      const { bytesRead } = await handle.read(buffer, total, cap - total, null);
      if (bytesRead === 0) {
        break;
      }
      total += bytesRead;
    }
    if (total > maxBytes) {
      throw new TeamFileError(tooBig);
    }
    return buffer.subarray(0, total);
  } finally {
    await handle.close();
  }
}

async function readResolved(
  root: string,
  path: TeamPath,
  maxBytes: number,
): Promise<TeamFileRead> {
  let realFile: string;
  try {
    realFile = await realpath(join(root, TULIS_FOLDER, ...path));
  } catch (error) {
    if (isMissingCode(errorCode(error))) {
      return { kind: "missing" };
    }
    throw new TeamFileError("The file could not be read.", { cause: error });
  }

  if (!isInside(root, realFile)) {
    throw new TeamFileError(
      "The file points outside the repository, so it was not read.",
    );
  }

  let bytes: Buffer;
  try {
    bytes = await readCapped(realFile, maxBytes);
  } catch (error) {
    if (error instanceof TeamFileError) {
      throw error;
    }
    throw new TeamFileError("The file could not be read.", { cause: error });
  }

  try {
    const text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
    return { kind: "text", text };
  } catch (error) {
    throw new TeamFileError("The file is not valid UTF-8 text.", {
      cause: error,
    });
  }
}

/** Reads `.tulis/<path>` as UTF-8 text, at most maxBytes. */
export async function readTeamFile(
  repoRoot: string,
  path: TeamPath,
  maxBytes: number,
): Promise<TeamFileRead> {
  checkNames(path);
  const root = await resolveRoot(repoRoot);
  return readResolved(root, path, maxBytes);
}

/**
 * Names of the regular files directly inside `.tulis/<folder>` whose name ends
 * with `extension`, sorted by code unit order. A missing folder gives [].
 */
export async function listTeamFiles(
  repoRoot: string,
  folder: TeamPath,
  options: { readonly extension: string; readonly maxFiles: number },
): Promise<readonly string[]> {
  checkNames(folder);
  const root = await resolveRoot(repoRoot);

  let realFolder: string;
  try {
    realFolder = await realpath(join(root, TULIS_FOLDER, ...folder));
  } catch (error) {
    if (isMissingCode(errorCode(error))) {
      return [];
    }
    throw new TeamFileError("The folder could not be read.", { cause: error });
  }
  if (!isInside(root, realFolder)) {
    throw new TeamFileError(
      "The folder points outside the repository, so it was not read.",
    );
  }

  let entries;
  try {
    entries = await readdir(realFolder, { withFileTypes: true });
  } catch (error) {
    throw new TeamFileError("The folder could not be read.", { cause: error });
  }

  const names = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith(options.extension) && isValidName(name));
  if (names.length > options.maxFiles) {
    throw new TeamFileError(
      `The folder has more than ${String(options.maxFiles)} files.`,
    );
  }
  return names.sort();
}

export interface WriteTeamFileOptions {
  readonly maxBytes: number;
  /**
   * The text the caller read earlier (`null` when the file was missing). The
   * write is refused if the file on disk no longer matches.
   */
  readonly expected: string | null;
}

const NOT_A_REAL_FOLDER =
  "A folder in the way is not a real folder, so nothing was written.";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Windows can refuse a rename while another program has the file open. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = errorCode(error);
      const wait = RENAME_RETRY_DELAYS_MS[attempt];
      if ((code !== "EPERM" && code !== "EBUSY") || wait === undefined) {
        throw error;
      }
      await delay(wait);
    }
  }
}

/** Is `folder` an existing real directory (not a link)? null when missing. */
async function checkFolder(folder: string): Promise<boolean | null> {
  try {
    const info = await lstat(folder);
    return info.isDirectory();
  } catch (error) {
    if (isMissingCode(errorCode(error))) {
      return null;
    }
    throw error;
  }
}

async function writeUnchecked(
  root: string,
  path: TeamPath,
  text: string,
  options: WriteTeamFileOptions,
): Promise<void> {
  const folderNames = [TULIS_FOLDER, ...path.slice(0, -1)];
  const name = path[path.length - 1];
  if (name === undefined) {
    throw new TeamFileError("The file name is not allowed.");
  }

  // Existing folders must be real directories. Stop at the first missing one.
  let current = root;
  let missingFrom = folderNames.length;
  for (const [index, folderName] of folderNames.entries()) {
    const next = join(current, folderName);
    const state = await checkFolder(next);
    if (state === null) {
      missingFrom = index;
      break;
    }
    if (!state) {
      throw new TeamFileError(NOT_A_REAL_FOLDER);
    }
    current = next;
  }

  const target = join(current, name);
  let mode = 0o644;
  let existing: string | null = null;
  if (missingFrom === folderNames.length) {
    try {
      const info = await lstat(target);
      if (!info.isFile()) {
        throw new TeamFileError("The file is not a regular file.");
      }
      mode = info.mode & 0o777;
    } catch (error) {
      if (!isMissingCode(errorCode(error))) {
        throw error;
      }
    }
    const read = await readResolved(root, path, options.maxBytes);
    existing = read.kind === "text" ? read.text : null;
  }

  if (existing !== options.expected) {
    throw new TeamFileError(
      "The file changed while Tulis was editing it. Please try again.",
    );
  }

  for (const folderName of folderNames.slice(missingFrom)) {
    current = join(current, folderName);
    await mkdir(current);
    if ((await checkFolder(current)) !== true) {
      throw new TeamFileError(NOT_A_REAL_FOLDER);
    }
  }

  // A fixed short prefix, so a long target name can't push the temp name past
  // the file system's limit.
  const temp = join(
    current,
    `.tulis-write-${randomBytes(8).toString("hex")}.tmp`,
  );
  try {
    const handle = await open(temp, "wx", mode);
    try {
      await handle.chmod(mode);
      await handle.writeFile(text, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await renameWithRetry(temp, join(current, name));
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Atomically writes `.tulis/<path>`, creating folders when needed. */
export async function writeTeamFile(
  repoRoot: string,
  path: TeamPath,
  text: string,
  options: WriteTeamFileOptions,
): Promise<void> {
  checkNames(path);
  if (path.length === 0) {
    throw new TeamFileError("The file name is not allowed.");
  }
  if (Buffer.byteLength(text) > options.maxBytes) {
    throw new TeamFileError(
      `The text is larger than ${sizeText(options.maxBytes)}, so it was not written.`,
    );
  }
  const root = await resolveRoot(repoRoot);
  try {
    await writeUnchecked(root, path, text, options);
  } catch (error) {
    if (error instanceof TeamFileError) {
      throw error;
    }
    throw new TeamFileError("The file could not be written.", { cause: error });
  }
}
