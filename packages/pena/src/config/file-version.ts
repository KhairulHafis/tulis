export type FileVersion =
  /** No version key, or `version:` with no value. Read as version 1. */
  | { readonly status: "missing" }
  /** Not a safe integer of 1 or more. */
  | { readonly status: "invalid" }
  /** From 1 up to the current version. */
  | { readonly status: "supported"; readonly version: number }
  /** Above the current version. */
  | { readonly status: "newer"; readonly version: number };

export const MISSING_VERSION_MESSAGE =
  "No version line, so the file is read as version 1. Add `version: 1` at the top.";
export const INVALID_VERSION_MESSAGE =
  "version must be a whole number, 1 or more.";

export function newerVersionMessage(version: number): string {
  return `This file was made by a newer version of Tulis (file version ${String(version)}). Please upgrade Tulis.`;
}

/** Reads the top-level `version` of a team file. Only the map's own keys count. */
export function readFileVersion(
  map: Readonly<Record<string, unknown>>,
  current: number,
): FileVersion {
  if (!Object.hasOwn(map, "version")) {
    return { status: "missing" };
  }
  const version = map["version"];
  if (version === null) {
    return { status: "missing" };
  }
  if (
    typeof version !== "number" ||
    !Number.isSafeInteger(version) ||
    version < 1
  ) {
    return { status: "invalid" };
  }
  return version > current
    ? { status: "newer", version }
    : { status: "supported", version };
}
