export const MAX_PRODUCT_NAMES = 500;
export const MAX_PRODUCT_NAME_LENGTH = 100;

/** Longest run of spaces and tabs one name space may match. */
const MAX_GAP_BLANKS = 16;

export interface ProductNameMatcher {
  /** How many names were left out: invalid, duplicate after normalising, or over MAX_PRODUCT_NAMES. */
  readonly skipped: number;
}

export interface TextMatch {
  /** Offsets into the text passed to findProductNames, end exclusive. */
  readonly start: number;
  readonly end: number;
}

const SPACE = 0x20;
const TAB = 0x09;
const LF = 0x0a;
const CR = 0x0d;

interface TrieNode {
  readonly children: Map<number, TrieNode>;
  /** The first two children, kept in fields because most nodes have no more. */
  firstKey: number;
  first: TrieNode | undefined;
  secondKey: number;
  second: TrieNode | undefined;
  /** The child for a space, if any. */
  spaceChild: TrieNode | undefined;
  /** True when a name ends here. */
  terminal: boolean;
  /** Whether the name ending here ends in a word character. */
  endsInWord: boolean;
  /** Whether the name ending here starts with a word character. */
  startsInWord: boolean;
}

function newNode(): TrieNode {
  return {
    children: new Map(),
    firstKey: -1,
    first: undefined,
    secondKey: -1,
    second: undefined,
    spaceChild: undefined,
    terminal: false,
    endsInWord: false,
    startsInWord: false,
  };
}

class Matcher implements ProductNameMatcher {
  readonly skipped: number;
  readonly #root: TrieNode;
  /**
   * Per first code unit: true when every name starting with it begins with a
   * word character. Different characters can share a first code unit (two
   * astral characters share their high surrogate), so this only lets a walk
   * be skipped early; each name's own flag is checked when it matches.
   */
  readonly #startsInWord: Map<number, boolean>;

  constructor(
    root: TrieNode,
    startsInWord: Map<number, boolean>,
    skipped: number,
  ) {
    this.#root = root;
    this.#startsInWord = startsInWord;
    this.skipped = skipped;
  }

  static parts(matcher: ProductNameMatcher): {
    root: TrieNode;
    startsInWord: Map<number, boolean>;
  } {
    if (!(matcher instanceof Matcher)) {
      throw new TypeError("Not a matcher made by createProductNameMatcher");
    }
    return { root: matcher.#root, startsInWord: matcher.#startsInWord };
  }
}

const WORD_CHAR = /^[\p{L}\p{M}\p{N}]$/u;
const FORBIDDEN =
  /[\p{Cc}\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u;
// Whitespace controls are collapsed by normalising, so they are not rejected.
const COLLAPSIBLE_CONTROLS = /[\t\n\v\f\r]/g;

function isWordCodePoint(cp: number): boolean {
  if (cp < 128) {
    return (
      (cp >= 0x30 && cp <= 0x39) ||
      (cp >= 0x41 && cp <= 0x5a) ||
      (cp >= 0x61 && cp <= 0x7a)
    );
  }
  return WORD_CHAR.test(String.fromCodePoint(cp));
}

function normaliseName(name: string): string | undefined {
  // Whole-string checks run on bounded input: reject huge names first.
  if (name.length > MAX_PRODUCT_NAME_LENGTH * 4) return undefined;
  if (FORBIDDEN.test(name.replace(COLLAPSIBLE_CONTROLS, " "))) return undefined;
  const normalised = name.trim().split(/\s+/u).join(" ");
  if (normalised.length === 0) return undefined;
  if (Array.from(normalised).length > MAX_PRODUCT_NAME_LENGTH) return undefined;
  return normalised;
}

export function createProductNameMatcher(
  names: readonly string[],
): ProductNameMatcher {
  const root = newNode();
  const startsInWord = new Map<number, boolean>();
  const seen = new Set<string>();
  let skipped = 0;
  for (const raw of names) {
    const name = typeof raw === "string" ? normaliseName(raw) : undefined;
    if (
      name === undefined ||
      seen.has(name) ||
      seen.size >= MAX_PRODUCT_NAMES
    ) {
      skipped += 1;
      continue;
    }
    seen.add(name);
    let node = root;
    for (let i = 0; i < name.length; i += 1) {
      const unit = name.charCodeAt(i);
      let next = node.children.get(unit);
      if (next === undefined) {
        next = newNode();
        node.children.set(unit, next);
        if (node.first === undefined) {
          node.firstKey = unit;
          node.first = next;
        } else if (node.second === undefined) {
          node.secondKey = unit;
          node.second = next;
        }
        if (unit === SPACE) node.spaceChild = next;
      }
      node = next;
    }
    const chars = Array.from(name);
    const first = chars[0] ?? "";
    const last = chars[chars.length - 1] ?? "";
    node.terminal = true;
    const firstIsWord = isWordCodePoint(first.codePointAt(0) ?? 0);
    node.endsInWord = isWordCodePoint(last.codePointAt(0) ?? 0);
    node.startsInWord = firstIsWord;
    startsInWord.set(
      name.charCodeAt(0),
      firstIsWord && (startsInWord.get(name.charCodeAt(0)) ?? true),
    );
  }
  return new Matcher(root, startsInWord, skipped);
}

function codePointBefore(text: string, index: number): number {
  const low = text.charCodeAt(index - 1);
  if (low >= 0xdc00 && low <= 0xdfff && index >= 2) {
    const high = text.charCodeAt(index - 2);
    if (high >= 0xd800 && high <= 0xdbff) {
      return (high - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
    }
  }
  return low;
}

/**
 * Reads a gap of spaces, tabs and at most one line break starting at `index`.
 * Returns the index after the gap, or -1 if the gap is not allowed.
 * Stops reading as soon as the gap is too long.
 */
function skipGap(text: string, index: number): number {
  let blanks = 0;
  let breaks = 0;
  let i = index;
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (c === SPACE || c === TAB) {
      blanks += 1;
      if (blanks > MAX_GAP_BLANKS) return -1;
      i += 1;
    } else if (c === LF) {
      breaks += 1;
      if (breaks > 1) return -1;
      i += 1;
    } else if (c === CR) {
      breaks += 1;
      if (breaks > 1) return -1;
      i += text.charCodeAt(i + 1) === LF ? 2 : 1;
    } else {
      break;
    }
  }
  return i === index ? -1 : i;
}

/** Walks the trie from `start`; returns the end of the longest whole-word match, or -1. */
function longestAt(
  text: string,
  start: number,
  root: TrieNode,
  wordBefore: boolean,
): number {
  let best = -1;
  let node = root;
  let i = start;
  for (;;) {
    if (node.terminal && i > start && !(node.startsInWord && wordBefore)) {
      const next = i < text.length ? text.codePointAt(i) : undefined;
      if (!node.endsInWord || next === undefined || !isWordCodePoint(next)) {
        best = i;
      }
    }
    if (i >= text.length) break;
    const unit = text.charCodeAt(i);
    const spaced = node.spaceChild;
    if (
      spaced !== undefined &&
      (unit === SPACE || unit === TAB || unit === LF || unit === CR)
    ) {
      const following = text.charCodeAt(i + 1);
      if (
        unit === SPACE &&
        following !== SPACE &&
        following !== TAB &&
        following !== LF &&
        following !== CR
      ) {
        // Common case: a single space.
        node = spaced;
        i += 1;
        continue;
      }
      const after = skipGap(text, i);
      if (after === -1) break;
      node = spaced;
      i = after;
      continue;
    }
    const direct =
      unit === node.firstKey
        ? node.first
        : unit === node.secondKey
          ? node.second
          : node.children.size > 2
            ? node.children.get(unit)
            : undefined;
    if (direct === undefined) break;
    node = direct;
    i += 1;
  }
  return best;
}

export function findProductNames(
  matcher: ProductNameMatcher,
  text: string,
): TextMatch[] {
  const { root, startsInWord } = Matcher.parts(matcher);
  const matches: TextMatch[] = [];
  if (root.children.size === 0) return matches;
  let i = 0;
  while (i < text.length) {
    const startsWord = startsInWord.get(text.charCodeAt(i));
    if (startsWord === undefined) {
      i += 1;
      continue;
    }
    const wordBefore = i > 0 && isWordCodePoint(codePointBefore(text, i));
    if (startsWord && wordBefore) {
      i += 1;
      continue;
    }
    const end = longestAt(text, i, root, wordBefore);
    if (end === -1) {
      i += 1;
    } else {
      matches.push({ start: i, end });
      i = end;
    }
  }
  return matches;
}
