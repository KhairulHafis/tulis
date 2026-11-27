import { parseYaml } from "../config/parse-yaml.js";
import type { Frontmatter } from "./parse-markdown.js";

export const MAX_FRONTMATTER_BYTES = 64 * 1024;
export const MAX_FRONTMATTER_FIELDS = 200;
export const MAX_FRONTMATTER_VALUE_LENGTH = 1000;
export const LANGUAGE_FIELDS: readonly string[] = Object.freeze([
  "lang",
  "language",
  "locale",
]);

export type FrontmatterWarningCode =
  | "too-large"
  | "invalid-yaml"
  | "not-a-map"
  | "value-too-long"
  | "too-many-fields"
  | "duplicate-key";

export interface FrontmatterWarning {
  readonly code: FrontmatterWarningCode;
  /** 1-based line in the doc source (not in the frontmatter text). */
  readonly line: number;
}

export interface FrontmatterData {
  readonly format: "yaml" | "toml";
  /** Top-level string fields, in source order. */
  readonly fields: ReadonlyMap<string, string>;
  readonly warnings: readonly FrontmatterWarning[];
}

/** One string field found by a reader, with its line relative to the frontmatter text (1-based). */
interface RawField {
  readonly key: string;
  readonly value: string;
  readonly line: number;
}

/** Collects fields under the limits and records warnings. */
class FieldCollector {
  readonly fields = new Map<string, string>();
  readonly warnings: FrontmatterWarning[] = [];
  private tooMany = false;

  constructor(private readonly fenceLine: number) {}

  warn(code: FrontmatterWarningCode, relativeLine: number): void {
    this.warnings.push({ code, line: this.fenceLine + relativeLine });
  }

  add(field: RawField): void {
    if (field.value.length > MAX_FRONTMATTER_VALUE_LENGTH) {
      this.warn("value-too-long", field.line);
      return;
    }
    if (this.fields.size >= MAX_FRONTMATTER_FIELDS) {
      if (!this.tooMany) {
        this.tooMany = true;
        this.warn("too-many-fields", field.line);
      }
      return;
    }
    this.fields.set(field.key, field.value);
  }
}

function readYamlFields(text: string, collector: FieldCollector): void {
  let parsed: ReturnType<typeof parseYaml>;
  try {
    parsed = parseYaml(text);
  } catch (error) {
    const line =
      typeof error === "object" &&
      error !== null &&
      "line" in error &&
      typeof error.line === "number"
        ? error.line
        : 0;
    collector.warn("invalid-yaml", line);
    return;
  }
  const value = parsed.value;
  if (value === null) {
    return;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    collector.warn("not-a-map", 0);
    return;
  }
  const found: RawField[] = [];
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") {
      found.push({ key, value: item, line: parsed.lineOf([key]) ?? 0 });
    }
  }
  // Object.entries puts integer-like keys first; the source order is by line.
  // Keys without a line (0) keep their relative order at the end.
  const lineKey = (field: RawField): number =>
    field.line === 0 ? Number.POSITIVE_INFINITY : field.line;
  found.sort((a, b) => {
    const left = lineKey(a);
    const right = lineKey(b);
    return left === right ? 0 : left < right ? -1 : 1;
  });
  for (const field of found) {
    collector.add(field);
  }
}

// TOML reader: top-level `key = "value"` lines only.

const SPACE = new Set([" ", "\t"]);
const HEX = /^[0-9A-Fa-f]+$/;
const BARE_KEY = /^[A-Za-z0-9_-]+$/;

function skipSpace(line: string, from: number): number {
  let pos = from;
  while (pos < line.length && SPACE.has(line.charAt(pos))) {
    pos += 1;
  }
  return pos;
}

/** True when only spaces and an optional comment remain. */
function onlyTrailer(line: string, from: number): boolean {
  const pos = skipSpace(line, from);
  return pos >= line.length || line.charAt(pos) === "#";
}

const SIMPLE_ESCAPES: ReadonlyMap<string, string> = new Map([
  ['"', '"'],
  ["\\", "\\"],
  ["b", "\b"],
  ["t", "\t"],
  ["n", "\n"],
  ["f", "\f"],
  ["r", "\r"],
]);

/** Reads a basic string whose opening quote is at `start`. Returns undefined when invalid. */
function readBasicString(
  line: string,
  start: number,
): { value: string; end: number } | undefined {
  const parts: string[] = [];
  let pos = start + 1;
  while (pos < line.length) {
    const char = line.charAt(pos);
    if (char === '"') {
      return { value: parts.join(""), end: pos + 1 };
    }
    if (char !== "\\") {
      parts.push(char);
      pos += 1;
      continue;
    }
    const code = line.charAt(pos + 1);
    const simple = SIMPLE_ESCAPES.get(code);
    if (simple !== undefined) {
      parts.push(simple);
      pos += 2;
      continue;
    }
    const digits = code === "u" ? 4 : code === "U" ? 8 : 0;
    if (digits === 0) {
      return undefined;
    }
    const hex = line.slice(pos + 2, pos + 2 + digits);
    if (hex.length !== digits || !HEX.test(hex)) {
      return undefined;
    }
    const point = Number.parseInt(hex, 16);
    if ((point >= 0xd800 && point <= 0xdfff) || point > 0x10ffff) {
      return undefined;
    }
    parts.push(String.fromCodePoint(point));
    pos += 2 + digits;
  }
  return undefined;
}

/** Reads a key at `start`. Returns undefined when it is not a usable key. */
function readKey(
  line: string,
  start: number,
): { key: string; end: number } | undefined {
  if (line.charAt(start) === '"') {
    const close = line.indexOf('"', start + 1);
    if (close === -1) {
      return undefined;
    }
    const key = line.slice(start + 1, close);
    if (key.includes("\\")) {
      return undefined;
    }
    return { key, end: close + 1 };
  }
  let end = start;
  while (end < line.length && /[A-Za-z0-9_-]/.test(line.charAt(end))) {
    end += 1;
  }
  const key = line.slice(start, end);
  return BARE_KEY.test(key) ? { key, end } : undefined;
}

/**
 * Finds the end of a multi-line string opened on line `startLine` at column
 * `from` (just after the opening delimiter). Returns the index of the line
 * holding the closing delimiter, or lines.length when it never closes.
 */
function skipMultiline(
  lines: readonly string[],
  startLine: number,
  from: number,
  quote: string,
): number {
  const delimiter = quote.repeat(3);
  for (let index = startLine; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    let pos = index === startLine ? from : 0;
    while (pos < line.length) {
      const char = line.charAt(pos);
      if (char === "\\" && quote === '"') {
        pos += 2;
      } else if (line.startsWith(delimiter, pos)) {
        return index;
      } else {
        pos += 1;
      }
    }
  }
  return lines.length;
}

function readTomlFields(text: string, collector: FieldCollector): void {
  const lines = text.split(/\r?\n/);
  const seen = new Set<string>();
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const lineNumber = index + 1;
    index += 1;
    const start = skipSpace(line, 0);
    const first = line.charAt(start);
    if (start >= line.length || first === "#") {
      continue;
    }
    if (first === "[") {
      return;
    }
    const key = readKey(line, start);
    if (key === undefined) {
      continue;
    }
    const equals = skipSpace(line, key.end);
    if (line.charAt(equals) !== "=") {
      continue;
    }
    const valueStart = skipSpace(line, equals + 1);
    const opener = line.charAt(valueStart);
    const duplicate = seen.has(key.key);
    seen.add(key.key);

    let value: string | undefined;
    if (
      (opener === '"' || opener === "'") &&
      line.startsWith(opener.repeat(3), valueStart)
    ) {
      index = skipMultiline(lines, lineNumber - 1, valueStart + 3, opener) + 1;
    } else if (opener === '"') {
      const parsed = readBasicString(line, valueStart);
      if (parsed !== undefined && onlyTrailer(line, parsed.end)) {
        value = parsed.value;
      }
    } else if (opener === "'") {
      const close = line.indexOf("'", valueStart + 1);
      if (close !== -1 && onlyTrailer(line, close + 1)) {
        value = line.slice(valueStart + 1, close);
      }
    }
    if (duplicate) {
      collector.warn("duplicate-key", lineNumber);
    } else if (value !== undefined) {
      collector.add({ key: key.key, value, line: lineNumber });
    }
  }
}

/** Reads the top-level string fields of a doc's frontmatter. Never throws on bad input. */
export function readFrontmatter(frontmatter: Frontmatter): FrontmatterData {
  const collector = new FieldCollector(frontmatter.position.start.line);
  if (Buffer.byteLength(frontmatter.value, "utf8") > MAX_FRONTMATTER_BYTES) {
    collector.warn("too-large", 0);
  } else if (frontmatter.format === "yaml") {
    readYamlFields(frontmatter.value, collector);
  } else {
    readTomlFields(frontmatter.value, collector);
  }
  return {
    format: frontmatter.format,
    fields: collector.fields,
    warnings: collector.warnings,
  };
}

/** The `title` field, trimmed. undefined when missing or empty. */
export function frontmatterTitle(data: FrontmatterData): string | undefined {
  const title = data.fields.get("title")?.trim();
  return title === undefined || title === "" ? undefined : title;
}

const LANGUAGE_TAG = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{1,8})*$/;

/** True when the first of lang, language, locale that is present holds a language tag other than English. */
export function isNonEnglish(data: FrontmatterData): boolean {
  for (const name of LANGUAGE_FIELDS) {
    const raw = data.fields.get(name);
    if (raw === undefined) {
      continue;
    }
    const value = raw.trim();
    if (!LANGUAGE_TAG.test(value)) {
      return false;
    }
    const primary = value.split(/[-_]/, 1)[0] ?? "";
    return primary.toLowerCase() !== "en";
  }
  return false;
}
