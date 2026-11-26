export const KILOBYTE = 1024;
export const MEGABYTE = 1024 * 1024;
export const MIN_MAX_FILE_SIZE = KILOBYTE;
export const MAX_MAX_FILE_SIZE = 10 * MEGABYTE;
export const DEFAULT_MAX_FILE_SIZE = MEGABYTE;

const SIZE_TEXT = /^([1-9][0-9]{0,4})(KB|MB)$/;

/** Bytes for a whole number >= 0, or for text like "1MB" or "500KB". undefined when the format is wrong. Does not check the allowed range. */
export function parseFileSize(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const match = SIZE_TEXT.exec(value);
  if (match === null) {
    return undefined;
  }
  const amount = Number(match[1]);
  return amount * (match[2] === "MB" ? MEGABYTE : KILOBYTE);
}
