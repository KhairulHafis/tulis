import type { Token } from "../language/tokens.js";
import type { PreparedBlock } from "../prepare/prepare-doc.js";

const MAX_NAME_LENGTH = 200;
/** A shortcode source is at most this long, so the tag regex runs on a bounded string. */
const MAX_TAG_LENGTH = 1000;

/** `{{% heading "x" %}}` or `{{< heading "x" >}}`; x is 1 to 100 characters with no quote. */
const HEADING_TAG =
  /^\{\{(?:% *heading +"([^"]{1,100})" *%|< *heading +"([^"]{1,100})" *>)\}\}$/u;

function blockTokens(block: PreparedBlock): Token[] {
  return block.sentences.flatMap((sentence) => [...sentence.tokens]);
}

function headingTagArgument(token: Token, source: string): string | undefined {
  const { start, end } = token.source;
  if (end - start > MAX_TAG_LENGTH) {
    return undefined;
  }
  const match = HEADING_TAG.exec(source.slice(start, end));
  return match?.[1] ?? match?.[2];
}

/** NFC, lower case, whitespace runs to one space, one trailing ":" or "." removed. */
function normalise(name: string): string {
  let result = name.normalize("NFC").toLowerCase().replace(/\s+/gu, " ").trim();
  if (result.endsWith(":") || result.endsWith(".")) {
    result = result.slice(0, -1).trim();
  }
  return result;
}

/** The normalised section name of an H2 block, or undefined when it has none. */
export function sectionName(
  block: PreparedBlock,
  source: string,
): string | undefined {
  const tokens = blockTokens(block);
  const only = tokens.length === 1 ? tokens[0] : undefined;
  let name: string | undefined;
  if (only?.placeholder === "SHORTCODE") {
    name = headingTagArgument(only, source);
  }
  if (name === undefined) {
    const hasWord = tokens.some(
      (token) => token.kind === "word" || token.kind === "number",
    );
    if (!hasWord) {
      return undefined;
    }
    name = block.masked.text;
  }
  const result = normalise(name);
  if (result === "" || result.length > MAX_NAME_LENGTH) {
    return undefined;
  }
  return result;
}
