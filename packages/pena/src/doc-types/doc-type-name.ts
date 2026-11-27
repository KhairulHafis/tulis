const DOC_TYPE_NAME = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/;

/** True when `value` is a valid doc type name: letters, digits, spaces, `_` or `-`, starting with a letter or digit, up to 64 characters. */
export function isDocTypeName(value: string): boolean {
  return DOC_TYPE_NAME.test(value);
}
