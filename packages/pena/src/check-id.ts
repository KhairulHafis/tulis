export const MAX_CHECK_LENGTH = 128;
export const MIN_CHECK_PARTS = 2;
export const MAX_CHECK_PARTS = 4;
const CHECK_PART = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** True when `value` is a check ID such as "term.sign-in". */
export function isCheckId(value: string): boolean {
  if (value.length > MAX_CHECK_LENGTH) {
    return false;
  }
  const parts = value.split(".");
  return (
    parts.length >= MIN_CHECK_PARTS &&
    parts.length <= MAX_CHECK_PARTS &&
    parts.every((part) => CHECK_PART.test(part))
  );
}
