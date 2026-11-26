export interface SafeTextOptions {
  /** Longest result before "..." is appended. Default 100. */
  readonly maxLength?: number;
  /** Keep "\n" line breaks (for multi-line git stderr). Default false. */
  readonly keepNewlines?: boolean;
}

const DEFAULT_MAX_LENGTH = 100;

function isUnsafeCode(code: number): boolean {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x061c ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

/** Makes untrusted text safe to show in a terminal or error message. */
export function toSafeText(text: string, options?: SafeTextOptions): string {
  const maxLength = options?.maxLength ?? DEFAULT_MAX_LENGTH;
  const keepNewlines = options?.keepNewlines ?? false;
  if (!Number.isInteger(maxLength) || maxLength < 1) {
    throw new Error("maxLength must be an integer of 1 or more");
  }

  const normalised = text.replaceAll("\r\n", "\n");
  let result = "";
  for (let i = 0; i < normalised.length; i++) {
    const code = normalised.charCodeAt(i);
    if (code === 0x0a && keepNewlines) {
      result += "\n";
    } else if (isUnsafeCode(code)) {
      result += "?";
    } else {
      result += normalised.charAt(i);
    }
  }

  if (result.length <= maxLength) {
    return result;
  }
  let cut = result.slice(0, maxLength);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) {
    cut = cut.slice(0, -1);
  }
  return `${cut}...`;
}
