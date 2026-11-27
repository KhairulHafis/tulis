import {
  LineCounter,
  isAlias,
  isMap,
  isNode,
  isScalar,
  isSeq,
  parseDocument,
} from "yaml";
import type { Document, Node } from "yaml";
import { toSafeText } from "../git/safe-text.js";

/** A path into parsed YAML: map keys as strings, list positions as 0-based numbers. */
export type YamlPath = readonly (string | number)[];

export const DEFAULT_MAX_YAML_BYTES = 64 * 1024;
export const DEFAULT_MAX_YAML_ALIASES = 10;
export const DEFAULT_MAX_YAML_DEPTH = 32;

export interface ParseYamlOptions {
  /** Largest input in UTF-8 bytes. Default DEFAULT_MAX_YAML_BYTES. */
  readonly maxBytes?: number;
  /** Passed to yaml's maxAliasCount. Default DEFAULT_MAX_YAML_ALIASES. */
  readonly maxAliases?: number;
  /** Deepest nesting of maps and lists. Default DEFAULT_MAX_YAML_DEPTH. */
  readonly maxDepth?: number;
}

export interface ParsedYaml {
  /** Plain data: objects, arrays, strings, numbers, booleans, null. An empty or comments-only file gives null. */
  readonly value: unknown;
  /** 1-based line of a map entry's key, or of a list item. undefined when the path doesn't exist. */
  readonly lineOf: (path: YamlPath) => number | undefined;
}

export class YamlParseError extends Error {
  /** 1-based line of the problem, when known. */
  readonly line: number | undefined;
  /** What is wrong, without the line. Safe to show. */
  readonly reason: string;

  constructor(reason: string, line?: number, options?: ErrorOptions) {
    super(
      line === undefined
        ? `YAML error: ${reason}`
        : `YAML error on line ${String(line)}: ${reason}`,
      options,
    );
    this.name = "YamlParseError";
    this.line = line;
    this.reason = reason;
  }
}

const NESTING_MESSAGE = "nesting is too deep";
const ALIAS_MESSAGE =
  "too many aliases, or an alias that points to a missing anchor";

/** Tags the YAML 1.2 core schema defines. Any other tag is refused. */
const ALLOWED_TAGS: ReadonlySet<string> = new Set([
  "tag:yaml.org,2002:str",
  "tag:yaml.org,2002:int",
  "tag:yaml.org,2002:float",
  "tag:yaml.org,2002:bool",
  "tag:yaml.org,2002:null",
  "tag:yaml.org,2002:map",
  "tag:yaml.org,2002:seq",
]);

function requireInteger(name: string, value: number, min: number): void {
  if (!Number.isInteger(value) || value < min) {
    throw new Error(
      min === 0
        ? `${name} must be an integer of 0 or more`
        : `${name} must be a positive integer`,
    );
  }
}

function firstLine(text: string): string {
  const end = text.search(/[\r\n]/);
  return end === -1 ? text : text.slice(0, end);
}

function safeReason(message: string): string {
  return toSafeText(firstLine(message), { maxLength: 200 });
}

function isStackOverflow(error: unknown): boolean {
  return error instanceof RangeError;
}

function lineAt(
  lineCounter: LineCounter,
  offset: number | undefined,
): number | undefined {
  return offset === undefined ? undefined : lineCounter.linePos(offset).line;
}

function asNode(value: unknown): Node | null {
  return isNode(value) ? value : null;
}

function nodeLine(
  lineCounter: LineCounter,
  node: Node | null,
): number | undefined {
  return lineAt(lineCounter, node?.range?.[0]);
}

/** Refuses disallowed tags and keys that are not plain strings. */
function checkNodes(root: Node | null, lineCounter: LineCounter): void {
  const stack: (Node | null)[] = [root];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (node === null || isAlias(node)) {
      continue;
    }
    if (node.tag !== undefined && !ALLOWED_TAGS.has(node.tag)) {
      throw new YamlParseError(
        "tags other than the standard ones are not allowed",
        nodeLine(lineCounter, node),
      );
    }
    if (isMap(node)) {
      for (const pair of node.items) {
        const key = asNode(pair.key);
        if (!isScalar(key) || typeof key.value !== "string") {
          throw new YamlParseError(
            "map keys must be plain strings",
            nodeLine(lineCounter, key ?? asNode(pair.value)),
          );
        }
        stack.push(key, asNode(pair.value));
      }
    } else if (isSeq(node)) {
      for (const item of node.items) {
        stack.push(asNode(item));
      }
    }
  }
}

interface Frame {
  readonly value: object;
  readonly children: readonly unknown[];
  next: number;
}

function childrenOf(value: object): readonly unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : Object.values(value);
}

/**
 * Checks the converted data iteratively. Counts depth through aliases and
 * refuses recursive structures (an anchor that contains its own alias).
 */
function checkDepth(root: unknown, maxDepth: number): void {
  if (typeof root !== "object" || root === null) {
    return;
  }
  const frames: Frame[] = [
    { value: root, children: childrenOf(root), next: 0 },
  ];
  const ancestors = new Set<object>([root]);
  while (frames.length > 0) {
    const frame = frames[frames.length - 1];
    if (frame === undefined) {
      break;
    }
    if (frame.next >= frame.children.length) {
      ancestors.delete(frame.value);
      frames.pop();
      continue;
    }
    const child = frame.children[frame.next];
    frame.next += 1;
    if (typeof child !== "object" || child === null) {
      continue;
    }
    if (ancestors.has(child)) {
      throw new YamlParseError("recursive aliases are not allowed");
    }
    if (frames.length >= maxDepth) {
      throw new YamlParseError(NESTING_MESSAGE);
    }
    ancestors.add(child);
    frames.push({ value: child, children: childrenOf(child), next: 0 });
  }
}

function findLine(
  doc: Document.Parsed,
  lineCounter: LineCounter,
  path: YamlPath,
): number | undefined {
  let node: unknown = doc.contents;
  let line = nodeLine(lineCounter, doc.contents);
  for (const segment of path) {
    if (isMap(node) && typeof segment === "string") {
      const pair = node.items.find(
        (p) => isScalar(p.key) && p.key.value === segment,
      );
      if (pair === undefined) {
        return undefined;
      }
      line = nodeLine(lineCounter, asNode(pair.key));
      node = pair.value;
    } else if (isSeq(node) && typeof segment === "number") {
      const item = asNode(node.items[segment]);
      if (item === null) {
        return undefined;
      }
      line = nodeLine(lineCounter, item);
      node = item;
    } else {
      return undefined;
    }
  }
  return line;
}

function parseOrExplain(
  text: string,
  lineCounter: LineCounter,
): Document.Parsed {
  try {
    return parseDocument(text, {
      schema: "core",
      version: "1.2",
      merge: false,
      uniqueKeys: true,
      strict: true,
      prettyErrors: false,
      lineCounter,
    });
  } catch (error) {
    if (isStackOverflow(error)) {
      throw new YamlParseError(NESTING_MESSAGE, undefined, { cause: error });
    }
    throw error;
  }
}

interface ParsedInternal extends ParsedYaml {
  readonly document: Document.Parsed;
  readonly lineCounter: LineCounter;
}

/** The one place that parses and checks untrusted YAML. */
function parseChecked(text: string, options: ParseYamlOptions): ParsedInternal {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_YAML_BYTES;
  const maxAliases = options.maxAliases ?? DEFAULT_MAX_YAML_ALIASES;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_YAML_DEPTH;
  requireInteger("maxBytes", maxBytes, 1);
  requireInteger("maxAliases", maxAliases, 0);
  requireInteger("maxDepth", maxDepth, 1);

  const size = Buffer.byteLength(text, "utf8");
  if (size > maxBytes) {
    throw new YamlParseError(
      `the file is larger than the limit of ${String(Math.round((maxBytes / 1024) * 10) / 10)} KB`,
    );
  }

  const lineCounter = new LineCounter();
  const doc = parseOrExplain(text, lineCounter);

  const problem = doc.errors[0] ?? doc.warnings[0];
  if (problem !== undefined) {
    if (problem.message.includes("Maximum call stack size exceeded")) {
      throw new YamlParseError(NESTING_MESSAGE);
    }
    throw new YamlParseError(
      safeReason(problem.message),
      lineAt(lineCounter, problem.pos[0]),
    );
  }
  if (doc.directives.yaml.version !== "1.2") {
    throw new YamlParseError("only YAML 1.2 is supported");
  }

  checkNodes(doc.contents, lineCounter);

  let value: unknown;
  try {
    // yaml refuses when the count reaches its limit, so add one to allow
    // exactly maxAliases simple aliases.
    value = doc.toJS({ maxAliasCount: maxAliases + 1 });
  } catch (error) {
    if (isStackOverflow(error)) {
      throw new YamlParseError(NESTING_MESSAGE, undefined, { cause: error });
    }
    if (error instanceof ReferenceError) {
      throw new YamlParseError(ALIAS_MESSAGE);
    }
    throw error;
  }
  checkDepth(value, maxDepth);

  return {
    value,
    lineOf: (path) => findLine(doc, lineCounter, path),
    document: doc,
    lineCounter,
  };
}

/** Parses YAML text from an untrusted file into plain data. */
export function parseYaml(
  text: string,
  options: ParseYamlOptions = {},
): ParsedYaml {
  const { value, lineOf } = parseChecked(text, options);
  return { value, lineOf };
}

export type LineEnding = "\n" | "\r\n";

export interface ParsedYamlDocument extends ParsedYaml {
  /** The parsed document. Edit it with yaml's document API (for example doc.setIn, doc.addIn), never by rebuilding it from plain data. `lineOf` answers refer to the original text, so they go stale after edits. */
  readonly document: Document.Parsed;
  /** "\r\n" when the text's first line break is CRLF, otherwise "\n". */
  readonly lineEnding: LineEnding;
  /** True when the text starts with a UTF-8 byte order mark (U+FEFF). */
  readonly hasBom: boolean;
  /**
   * False when the file's first block list under a map key starts in the same
   * column as its key (`key:\n- a`), true when it is indented or when the
   * file has no such list. Pass it back to serializeYamlDocument.
   */
  readonly indentSeq: boolean;
}

function columnOf(lineCounter: LineCounter, node: Node): number | undefined {
  const offset = node.range?.[0];
  return offset === undefined ? undefined : lineCounter.linePos(offset).col;
}

interface Entry {
  readonly key: Node | null;
  readonly value: Node | null;
}

/** Looks at the first block list that is a map value, in document order. */
function detectIndentSeq(root: Node | null, lineCounter: LineCounter): boolean {
  const stack: Entry[] = [{ key: null, value: root }];
  for (let entry = stack.pop(); entry !== undefined; entry = stack.pop()) {
    const { key, value } = entry;
    if (value === null || isAlias(value)) {
      continue;
    }
    if (isSeq(value) && value.flow !== true && key !== null) {
      const keyColumn = columnOf(lineCounter, key);
      const seqColumn = columnOf(lineCounter, value);
      if (keyColumn !== undefined && seqColumn !== undefined) {
        return seqColumn > keyColumn;
      }
    }
    if (isMap(value)) {
      for (const pair of [...value.items].reverse()) {
        stack.push({ key: asNode(pair.key), value: asNode(pair.value) });
      }
    } else if (isSeq(value)) {
      for (const item of [...value.items].reverse()) {
        stack.push({ key: null, value: asNode(item) });
      }
    }
  }
  return true;
}

function detectLineEnding(text: string): LineEnding {
  const lf = text.indexOf("\n");
  return lf > 0 && text[lf - 1] === "\r" ? "\r\n" : "\n";
}

/** Parses untrusted YAML into an editable document. Same checks and errors as parseYaml. */
export function parseYamlDocument(
  text: string,
  options: ParseYamlOptions = {},
): ParsedYamlDocument {
  const { value, lineOf, document, lineCounter } = parseChecked(text, options);
  return {
    value,
    lineOf,
    document,
    indentSeq: detectIndentSeq(document.contents, lineCounter),
    lineEnding: detectLineEnding(text),
    hasBom: text.startsWith("\uFEFF"),
  };
}

export interface SerializeYamlOptions extends ParseYamlOptions {
  readonly lineEnding?: LineEnding; // default "\n"
  readonly bom?: boolean; // default false
  /** Print block lists under a map key indented. Default true. */
  readonly indentSeq?: boolean;
}

/**
 * Turns an edited document back into text, then parses that text again with
 * the same limits (throws YamlParseError if it would not read back, for
 * example because it grew past maxBytes).
 *
 * `lineOf` answers refer to the original text, so they go stale after edits.
 * yaml prints one space before an end-of-line comment, so extra spaces there
 * are not kept, and a comment at the very end of the file gets a blank line
 * before it.
 */
export function serializeYamlDocument(
  document: Document,
  options: SerializeYamlOptions = {},
): string {
  let text: string;
  try {
    // lineWidth 0 stops long strings from being folded; no padding keeps
    // flow lists as written: ["a", "b"].
    text = document.toString({
      lineWidth: 0,
      flowCollectionPadding: false,
      indentSeq: options.indentSeq ?? true,
    });
  } catch (error) {
    if (isStackOverflow(error)) {
      throw new YamlParseError(NESTING_MESSAGE, undefined, { cause: error });
    }
    throw error;
  }
  if (options.lineEnding === "\r\n") {
    text = text.replaceAll("\n", "\r\n");
  }
  if (options.bom === true) {
    text = `\uFEFF${text}`;
  }
  // Prove the text reads back under the same rules.
  parseChecked(text, options);
  return text;
}
