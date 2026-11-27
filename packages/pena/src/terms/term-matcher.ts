import type { SourceRange } from "../markdown/ignored-ranges.js";
import type { PreparedSentence } from "../prepare/prepare-doc.js";
import { MAX_OBSERVATION_VALUE_LENGTH } from "../extract/observation.js";
import { termKey } from "./term-key.js";
import { inflectedForms } from "./word-forms.js";

export interface TermEntry {
  /** A variant as written in its group. */
  readonly text: string;
  /** Caller's group number, returned on matches. */
  readonly group: number;
}

export interface TermMatch {
  readonly group: number;
  /**
   * Index into the group's entries order as given (counting only the entries
   * of that group): the entry whose variant matched, base or inflected.
   */
  readonly entry: number;
  /** The writer's text, as the base variant in the writer's spelling. */
  readonly value: string;
  /** From the first matched token's source.start to the last one's source.end. */
  readonly range: SourceRange;
}

export interface TermMatcher {
  /** Matches in order of range start, then group. */
  find(sentence: PreparedSentence, source: string): readonly TermMatch[];
  /** How many keys the matcher holds (base and inflected spellings). */
  readonly keyCount: number;
}

/** What a key points to. */
interface KeyTarget {
  readonly group: number;
  readonly entry: number;
  readonly isBase: boolean;
  /** Key characters before the changed word (inflected keys only). */
  readonly offset: number;
  /** Key of the changed word in the base variant (inflected keys only). */
  readonly baseWordKey: string;
  /** Key of the same word in the inflected form (inflected keys only). */
  readonly formWordKey: string;
}

interface Candidate {
  readonly target: KeyTarget;
  readonly matchedKey: string;
  /** Index of the last token of the window. */
  readonly lastToken: number;
}

const WHITESPACE = /\s+/gu;
const BLANK = /^\s*$/u;
const HYPHEN_2010 = String.fromCodePoint(0x2010);
const HYPHEN_2011 = String.fromCodePoint(0x2011);
const SOFT_HYPHEN = String.fromCodePoint(0x00ad);

/** The writer's text for a window: NFC, lower case, one space per gap. */
function normalizeValue(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(WHITESPACE, " ")
    .replaceAll(HYPHEN_2010, "-")
    .replaceAll(HYPHEN_2011, "-")
    .replaceAll(SOFT_HYPHEN, "");
}

function commonPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a[i] === b[i]) {
    i += 1;
  }
  return i;
}

/** A character of a normalized value that counts in the key. */
function isKeyChar(char: string): boolean {
  return char !== " " && char !== "-";
}

/**
 * Turns the writer's text for an inflected form into the base variant in the
 * same spelling: `logged-in` gives `log-in`, `Choosing` gives `choose`. Only
 * the changed word is rewritten: keep `offset + lcp` key characters, drop the
 * rest of the form's word, insert the rest of the base word.
 */
function restoreBase(value: string, target: KeyTarget): string {
  const lcp = commonPrefixLength(target.formWordKey, target.baseWordKey);
  const keep = target.offset + lcp;
  let index = 0;
  let passed = 0;
  while (passed < keep && index < value.length) {
    if (isKeyChar(value.charAt(index))) {
      passed += 1;
    }
    index += 1;
  }
  const kept = value.slice(0, index);
  const toDrop = target.formWordKey.length - lcp;
  let dropped = 0;
  while (dropped < toDrop && index < value.length) {
    if (isKeyChar(value.charAt(index))) {
      dropped += 1;
    }
    index += 1;
  }
  return kept + target.baseWordKey.slice(lcp) + value.slice(index);
}

/** The words of a variant, lower case, the way inflectedForms splits them. */
function wordsOf(text: string): string[] {
  return text.toLowerCase().replace(WHITESPACE, " ").trim().split(" ");
}

/** Where an inflected form differs from its base: the word and its offset. */
function changedWord(
  baseWords: readonly string[],
  baseWordKeys: readonly string[],
  formText: string,
): { offset: number; baseWordKey: string; formWordKey: string } {
  const formWords = wordsOf(formText);
  let offset = 0;
  for (let i = 0; i < baseWords.length; i += 1) {
    const baseWord = baseWords[i] ?? "";
    const formWord = formWords[i] ?? "";
    const baseWordKey = baseWordKeys[i] ?? "";
    if (baseWord !== formWord && baseWordKey !== termKey(formWord)) {
      return { offset, baseWordKey, formWordKey: termKey(formWord) };
    }
    offset += baseWordKey.length;
  }
  return { offset: 0, baseWordKey: "", formWordKey: "" };
}

function byKey(
  a: { readonly key: string },
  b: { readonly key: string },
): number {
  if (a.key < b.key) {
    return -1;
  }
  return a.key > b.key ? 1 : 0;
}

/**
 * Finds the entries' variants, in base and inflected spellings, in prepared
 * sentences. Keys live in one sorted array; a search narrows a range of it
 * one token at a time, so the work per token is bounded by the longest key.
 */
export function createTermMatcher(entries: readonly TermEntry[]): TermMatcher {
  const records: { key: string; target: KeyTarget }[] = [];
  const perGroup = new Map<number, number>();
  for (const entry of entries) {
    const entryIndex = perGroup.get(entry.group) ?? 0;
    perGroup.set(entry.group, entryIndex + 1);
    const baseKey = termKey(entry.text);
    if (baseKey === "") {
      continue;
    }
    const baseWords = wordsOf(entry.text);
    const baseWordKeys = baseWords.map(termKey);
    const seen = new Set<string>([baseKey]);
    records.push({
      key: baseKey,
      target: {
        group: entry.group,
        entry: entryIndex,
        isBase: true,
        offset: 0,
        baseWordKey: baseKey,
        formWordKey: baseKey,
      },
    });
    for (const form of inflectedForms(entry.text)) {
      const key = termKey(form);
      if (key !== "" && !seen.has(key)) {
        seen.add(key);
        records.push({
          key,
          target: {
            group: entry.group,
            entry: entryIndex,
            isBase: false,
            ...changedWord(baseWords, baseWordKeys, form),
          },
        });
      }
    }
  }
  records.sort(byKey);
  const keys = records.map((record) => record.key);
  const targets = records.map((record) => record.target);
  let longestKey = 0;
  for (const key of keys) {
    longestKey = Math.max(longestKey, key.length);
  }

  /** First index in [lo, hi) whose key is not below `prefix`. */
  function lowerBound(prefix: string, lo: number, hi: number): number {
    let low = lo;
    let high = hi;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if ((keys[mid] ?? "") < prefix) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return low;
  }

  /** First index in [lo, hi) whose key does not start with `prefix`. */
  function upperBound(prefix: string, lo: number, hi: number): number {
    let low = lo;
    let high = hi;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if ((keys[mid] ?? "").startsWith(prefix)) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return low;
  }

  function better(candidate: Candidate, current: Candidate | undefined) {
    if (current === undefined || candidate.lastToken > current.lastToken) {
      return true;
    }
    if (candidate.lastToken < current.lastToken) {
      return false;
    }
    if (candidate.target.isBase !== current.target.isBase) {
      return candidate.target.isBase;
    }
    return candidate.target.entry < current.target.entry;
  }

  function find(
    sentence: PreparedSentence,
    source: string,
  ): readonly TermMatch[] {
    const tokens = sentence.tokens;
    const tokenKeys: (string | undefined)[] = [];
    const keyOf = (index: number): string => {
      let key = tokenKeys[index];
      if (key === undefined) {
        key = termKey(tokens[index]?.text ?? "");
        tokenKeys[index] = key;
      }
      return key;
    };
    const gaps: (boolean | undefined)[] = [];
    /** Only whitespace in the source between token `index - 1` and `index`. */
    const joined = (index: number): boolean => {
      let ok = gaps[index];
      if (ok === undefined) {
        const previous = tokens[index - 1];
        const next = tokens[index];
        ok =
          previous !== undefined &&
          next !== undefined &&
          previous.source.end <= next.source.start &&
          BLANK.test(source.slice(previous.source.end, next.source.start));
        gaps[index] = ok;
      }
      return ok;
    };
    const lastEnd = new Map<number, number>();
    const matches: TermMatch[] = [];

    for (let start = 0; start < tokens.length; start += 1) {
      const first = tokens[start];
      if (
        first === undefined ||
        first.kind === "placeholder" ||
        keyOf(start) === ""
      ) {
        continue;
      }
      const best = new Map<number, Candidate>();
      let windowKey = "";
      let lo = 0;
      let hi = keys.length;
      let previousEmpty = false;
      for (let end = start; end < tokens.length; end += 1) {
        const token = tokens[end];
        if (token === undefined || token.kind === "placeholder") {
          break;
        }
        if (end > start && !joined(end)) {
          break;
        }
        const tokenKey = keyOf(end);
        if (tokenKey === "") {
          // A lone dash may sit between two keyed tokens, one at a time. A
          // match never ends on it, and a second one in a row stops growth.
          if (previousEmpty) {
            break;
          }
          previousEmpty = true;
          continue;
        }
        previousEmpty = false;
        if (windowKey.length + tokenKey.length > longestKey) {
          break;
        }
        windowKey += tokenKey;
        lo = lowerBound(windowKey, lo, hi);
        hi = upperBound(windowKey, lo, hi);
        if (lo >= hi) {
          break;
        }
        for (let i = lo; i < hi && keys[i] === windowKey; i += 1) {
          const target = targets[i];
          if (target === undefined) {
            continue;
          }
          const candidate: Candidate = {
            target,
            matchedKey: windowKey,
            lastToken: end,
          };
          if (better(candidate, best.get(target.group))) {
            best.set(target.group, candidate);
          }
        }
      }

      for (const [group, candidate] of best) {
        if ((lastEnd.get(group) ?? -1) >= start) {
          continue;
        }
        const last = tokens[candidate.lastToken];
        if (last === undefined) {
          continue;
        }
        const text = sentence.text.slice(
          first.maskedStart - sentence.maskedStart,
          last.maskedEnd - sentence.maskedStart,
        );
        const written = normalizeValue(text);
        const value = candidate.target.isBase
          ? written
          : restoreBase(written, candidate.target);
        if (value.length > MAX_OBSERVATION_VALUE_LENGTH) {
          continue;
        }
        lastEnd.set(group, candidate.lastToken);
        matches.push({
          group,
          entry: candidate.target.entry,
          value,
          range: { start: first.source.start, end: last.source.end },
        });
      }
    }
    return matches.sort(
      (a, b) => a.range.start - b.range.start || a.group - b.group,
    );
  }

  return { find, keyCount: keys.length };
}
