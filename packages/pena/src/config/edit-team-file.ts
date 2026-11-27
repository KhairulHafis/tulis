import { YAMLSeq, isMap, isScalar, isSeq } from "yaml";
import {
  YamlParseError,
  parseYamlDocument,
  serializeYamlDocument,
} from "./parse-yaml.js";
import type { ParsedYamlDocument, SerializeYamlOptions } from "./parse-yaml.js";
import { TeamFileError, writeTeamFile } from "./team-file.js";
import type { TeamPath } from "./team-file.js";

export type TeamFileEditOutcome =
  | { readonly status: "written" }
  | { readonly status: "already-present" }
  /** `reason` is one plain sentence, safe to show. */
  | { readonly status: "refused"; readonly reason: string };

export const UNSAFE_REASON = "The change could not be written safely.";

export function refused(reason: string): TeamFileEditOutcome {
  return { status: "refused", reason };
}

/** What a reader found, as far as an edit needs it. */
interface ReadForEdit {
  /** null when the file is missing. */
  readonly text: string | null;
  /** undefined when the file is missing or not valid YAML. */
  readonly parsed: ParsedYamlDocument | undefined;
}

/**
 * The document to edit: the file's own, or `newFileText` parsed when the file
 * is missing. undefined when there is nothing safe to edit.
 */
export function documentToEdit(
  file: ReadForEdit,
  newFileText: string,
  maxBytes: number,
): ParsedYamlDocument | undefined {
  if (file.text === null) {
    return parseYamlDocument(newFileText, { maxBytes });
  }
  return file.parsed;
}

/**
 * The top-level list under `key`, created when the key is missing or has no
 * value. An empty flow list (`key: []`) is switched to block style so new
 * entries print one per line. undefined when the file has another shape (for
 * example the key holds a map or an alias), so the caller refuses to edit.
 */
export function topLevelList(
  parsed: ParsedYamlDocument,
  key: string,
): YAMLSeq | undefined {
  const doc = parsed.document;
  if (doc.contents !== null && !isMap(doc.contents)) {
    return undefined;
  }
  const existing: unknown = doc.get(key, true);
  if (isSeq(existing)) {
    if (existing.items.length === 0) {
      existing.flow = false;
    }
    return existing;
  }
  if (
    existing === undefined ||
    (isScalar(existing) && existing.value === null)
  ) {
    const created = new YAMLSeq();
    doc.set(key, created);
    return created;
  }
  return undefined;
}

function tooBigReason(maxBytes: number): string {
  return `The change would make the file larger than ${String(Math.round(maxBytes / 1024))} KB, so it was not written.`;
}

/** Serializes again without the size limit, to tell "too big" from other failures. */
function explainSerializeFailure(
  parsed: ParsedYamlDocument,
  options: SerializeYamlOptions,
  maxBytes: number,
): string {
  try {
    const text = serializeYamlDocument(parsed.document, {
      ...options,
      maxBytes: Number.MAX_SAFE_INTEGER,
    });
    return Buffer.byteLength(text, "utf8") > maxBytes
      ? tooBigReason(maxBytes)
      : UNSAFE_REASON;
  } catch (error) {
    if (error instanceof YamlParseError) {
      return UNSAFE_REASON;
    }
    throw error;
  }
}

/**
 * Serializes an edited document in the file's own style (line endings, byte
 * order mark, list indentation) and writes it, refusing when the file changed
 * since `expected` was read or the result would not read back.
 */
export async function writeEditedDocument(
  repoRoot: string,
  path: TeamPath,
  parsed: ParsedYamlDocument,
  options: { readonly maxBytes: number; readonly expected: string | null },
): Promise<TeamFileEditOutcome> {
  const style: SerializeYamlOptions = {
    lineEnding: parsed.lineEnding,
    bom: parsed.hasBom,
    indentSeq: parsed.indentSeq,
  };
  let text: string;
  try {
    text = serializeYamlDocument(parsed.document, {
      ...style,
      maxBytes: options.maxBytes,
    });
  } catch (error) {
    if (!(error instanceof YamlParseError)) {
      throw error;
    }
    return refused(explainSerializeFailure(parsed, style, options.maxBytes));
  }

  try {
    await writeTeamFile(repoRoot, path, text, options);
  } catch (error) {
    if (error instanceof TeamFileError) {
      return refused(error.reason);
    }
    throw error;
  }
  return { status: "written" };
}
