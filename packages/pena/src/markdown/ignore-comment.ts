import { isCheckId } from "../check-id.js";
import { toSafeText } from "../git/safe-text.js";

export type IgnoreCommentKind = "next" | "start" | "end";

export interface IgnoreComment {
  readonly kind: IgnoreCommentKind;
  /** Check IDs in the order written, duplicates removed. Empty means every check. Always empty for "end". */
  readonly checks: readonly string[];
  /** The text after the first colon, trimmed, made safe with toSafeText(reason, { maxLength: 200 }). Undefined when missing or empty. */
  readonly reason: string | undefined;
}

export type IgnoreCommentProblem =
  | "unknown-form"
  | "bad-check-id"
  | "too-many-checks"
  | "end-with-checks"
  | "too-long";

export type IgnoreCommentReading =
  | { readonly status: "not-ignore" }
  | { readonly status: "ignore"; readonly comment: IgnoreComment }
  | { readonly status: "malformed"; readonly problem: IgnoreCommentProblem };

export const MAX_IGNORE_COMMENT_LENGTH = 1000;
export const MAX_IGNORE_CHECKS = 10;

const PREFIX = "tulis-ignore";
const MAX_REASON_LENGTH = 200;

/** The inside of `value` when it is exactly one comment with these markers. */
function commentBody(
  value: string,
  open: string,
  close: string,
): string | undefined {
  const trimmed = value.trim();
  if (
    trimmed.length < open.length + close.length ||
    !trimmed.startsWith(open) ||
    !trimmed.endsWith(close)
  ) {
    return undefined;
  }
  const body = trimmed.slice(open.length, trimmed.length - close.length);
  return body.includes(close) ? undefined : body;
}

/** The text between "<!--" and "-->" when the html node value is exactly one comment (surrounding whitespace allowed), otherwise undefined. */
export function htmlCommentBody(value: string): string | undefined {
  return commentBody(value, "<!--", "-->");
}

/** The text between "/*" and "*\/" when the mdx expression value is exactly one block comment (surrounding whitespace allowed), otherwise undefined. */
export function mdxCommentBody(value: string): string | undefined {
  return commentBody(value, "/*", "*/");
}

function startsWithPrefix(text: string): boolean {
  return text.slice(0, PREFIX.length).toLowerCase() === PREFIX;
}

function kindOf(keyword: string): IgnoreCommentKind | undefined {
  if (keyword === PREFIX) {
    return "next";
  }
  if (keyword === `${PREFIX}-start`) {
    return "start";
  }
  return keyword === `${PREFIX}-end` ? "end" : undefined;
}

/** Index of the first whitespace or colon, or the text length. */
function keywordEnd(text: string): number {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ":" || text.charAt(i).trim() === "") {
      return i;
    }
  }
  return text.length;
}

/** Reads a comment body (from either function above). */
export function readIgnoreComment(body: string): IgnoreCommentReading {
  if (body.length > MAX_IGNORE_COMMENT_LENGTH) {
    return startsWithPrefix(body.trimStart())
      ? { status: "malformed", problem: "too-long" }
      : { status: "not-ignore" };
  }

  const text = body.trim();
  const end = keywordEnd(text);
  const keyword = text.slice(0, end);
  if (!startsWithPrefix(keyword)) {
    return { status: "not-ignore" };
  }
  const kind = kindOf(keyword);
  if (kind === undefined) {
    return { status: "malformed", problem: "unknown-form" };
  }

  const rest = text.slice(end);
  const colon = rest.indexOf(":");
  const idText = colon === -1 ? rest : rest.slice(0, colon);
  const reasonText = colon === -1 ? "" : rest.slice(colon + 1).trim();

  const pieces = idText.split(/[\s,]+/).filter((piece) => piece !== "");
  if (kind === "end" && pieces.length > 0) {
    return { status: "malformed", problem: "end-with-checks" };
  }
  if (!pieces.every(isCheckId)) {
    return { status: "malformed", problem: "bad-check-id" };
  }
  const checks = [...new Set(pieces)];
  if (checks.length > MAX_IGNORE_CHECKS) {
    return { status: "malformed", problem: "too-many-checks" };
  }

  const reason =
    reasonText === ""
      ? undefined
      : toSafeText(reasonText, { maxLength: MAX_REASON_LENGTH });
  return {
    status: "ignore",
    comment: Object.freeze({ kind, checks: Object.freeze(checks), reason }),
  };
}
