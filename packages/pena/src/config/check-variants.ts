import type { ConfigPath, LineLookup } from "./config-types.js";
import {
  INVALID_VERSION_MESSAGE,
  MISSING_VERSION_MESSAGE,
  readFileVersion,
} from "./file-version.js";
import {
  addError,
  addIssue,
  finishList,
  formatKey,
  isMap,
  isSet,
  warnUnknownKeys,
} from "./issue-collector.js";
import type { Checker, ConfigMap } from "./issue-collector.js";
import type { TeamIssue } from "./team-issue.js";
import {
  EMPTY_TEAM_VARIANTS,
  VARIANTS_FORMAT_VERSION,
} from "./variants-types.js";
import type {
  RejectedGroup,
  TeamVariants,
  VariantGroup,
  VariantSource,
} from "./variants-types.js";

export interface VariantsCheckResult {
  /** Frozen. Entries with errors are left out. */
  readonly variants: TeamVariants;
  /** The file's `version`: set for supported and newer versions. */
  readonly fileVersion: number | undefined;
  readonly errors: readonly TeamIssue[];
  readonly warnings: readonly TeamIssue[];
}

const TOP_KEYS = ["version", "groups", "rejected"] as const;
const GROUP_KEYS = [
  "id",
  "kind",
  "variants",
  "noun",
  "verb",
  "source",
  "enabled",
] as const;
const REJECTED_KEYS = ["variants"] as const;

const MAX_ENTRIES = 1000;
const MAX_ID_LENGTH = 64;
const MIN_WORDS = 2;
const MAX_WORDS = 20;
const MAX_WORD_LENGTH = 100;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const WHITESPACE_RUN = /\s+/g;

const WORD_MESSAGE = `must be a word or phrase of 1 to ${String(MAX_WORD_LENGTH)} characters, without control or text-direction characters.`;

function normalizeWord(word: string): string {
  return word.trim().replace(WHITESPACE_RUN, " ").toLowerCase();
}

/** Key for matching rejected groups: each word trimmed, inner whitespace collapsed to one space, lower-cased, duplicates removed, sorted, joined with a line break. */
export function rejectedKey(words: readonly string[]): string {
  return [...new Set(words.map(normalizeWord))].sort().join("\n");
}

function isBidiControl(code: number): boolean {
  return (
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

function hasForbiddenCharacter(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || isBidiControl(code)) {
      return true;
    }
  }
  return false;
}

/** The trimmed word, or undefined (with an error) when it is not a valid word. */
function checkWord(
  ctx: Checker,
  value: unknown,
  path: ConfigPath,
): string | undefined {
  if (typeof value === "string") {
    const word = value.trim();
    if (
      word.length >= 1 &&
      word.length <= MAX_WORD_LENGTH &&
      !hasForbiddenCharacter(word)
    ) {
      return word;
    }
  }
  addError(ctx, path, `${formatKey(path)} ${WORD_MESSAGE}`);
  return undefined;
}

/** The trimmed words, or undefined (with errors) when the list is not valid. */
function checkWordList(
  ctx: Checker,
  value: unknown,
  path: ConfigPath,
): string[] | undefined {
  const key = formatKey(path);
  if (!Array.isArray(value)) {
    addError(ctx, path, `${key} must be a list of words.`);
    return undefined;
  }
  // Check the length first, so a huge list is never looped over.
  if (value.length < MIN_WORDS || value.length > MAX_WORDS) {
    addError(
      ctx,
      path,
      `${key} must have from ${String(MIN_WORDS)} to ${String(MAX_WORDS)} words.`,
    );
    return undefined;
  }
  const words: string[] = [];
  const seen = new Set<string>();
  let allValid = true;
  for (let i = 0; i < value.length; i++) {
    const itemPath = [...path, i];
    const word = checkWord(ctx, value[i], itemPath);
    if (word === undefined) {
      allValid = false;
      continue;
    }
    const normal = normalizeWord(word);
    if (seen.has(normal)) {
      allValid = false;
      addError(
        ctx,
        itemPath,
        `${formatKey(itemPath)} repeats another word in the list. Letter case and extra spaces don't count as different.`,
      );
    }
    seen.add(normal);
    words.push(word);
  }
  return allValid ? words : undefined;
}

interface CheckedGroup {
  readonly group: VariantGroup | undefined;
  /** Set when the entry has `enabled: false` and no errors. */
  readonly disabledId: string | undefined;
}

const LEFT_OUT: CheckedGroup = { group: undefined, disabledId: undefined };

/** Checks the `id` of an entry. Returns it when it is a valid string. */
function checkId(
  ctx: Checker,
  map: ConfigMap,
  path: ConfigPath,
): string | undefined {
  const key = formatKey(path);
  if (!isSet(map, "id")) {
    addError(ctx, path, `${key} needs an id.`);
    return undefined;
  }
  const raw = map["id"];
  if (
    typeof raw === "string" &&
    raw.length <= MAX_ID_LENGTH &&
    ID_PATTERN.test(raw)
  ) {
    return raw;
  }
  addError(
    ctx,
    [...path, "id"],
    `${key}.id must be lower-case letters and digits, with single \`-\` between parts, up to ${String(MAX_ID_LENGTH)} characters.`,
  );
  return undefined;
}

/** One group entry, at 0-based position `index` in `groups`. */
function checkGroup(
  ctx: Checker,
  value: unknown,
  index: number,
  seenIds: Map<string, number>,
): CheckedGroup {
  const path: ConfigPath = ["groups", index];
  const key = formatKey(path);
  if (!isMap(value)) {
    addError(
      ctx,
      path,
      `${key} must be a map with an id, a kind and its words.`,
    );
    return LEFT_OUT;
  }
  const errorsBefore = ctx.errors.total;
  warnUnknownKeys(ctx, value, GROUP_KEYS, path);

  const id = checkId(ctx, value, path);
  if (id !== undefined) {
    const first = seenIds.get(id);
    if (first === undefined) {
      seenIds.set(id, index);
    } else {
      const firstPath: ConfigPath = ["groups", first];
      const firstLine = ctx.lineOf?.(firstPath);
      const where =
        firstLine === undefined
          ? formatKey(firstPath)
          : `${formatKey(firstPath)} on line ${String(firstLine)}`;
      addError(
        ctx,
        [...path, "id"],
        `${key}.id is already used by ${where}. Each id can be used once.`,
      );
    }
  }

  let enabled = true;
  if (isSet(value, "enabled")) {
    const raw = value["enabled"];
    if (typeof raw === "boolean") {
      enabled = raw;
    } else {
      addError(
        ctx,
        [...path, "enabled"],
        `${key}.enabled must be true or false.`,
      );
    }
  }

  let source: VariantSource = "team";
  if (isSet(value, "source")) {
    if (value["source"] === "discovered") {
      source = "discovered";
    } else {
      addError(
        ctx,
        [...path, "source"],
        `${key}.source can only be "discovered", or left out.`,
      );
    }
  }

  let kind: "synonym" | "verb-noun" | undefined;
  if (isSet(value, "kind")) {
    const raw = value["kind"];
    if (raw === "synonym" || raw === "verb-noun") {
      kind = raw;
    } else {
      addError(
        ctx,
        [...path, "kind"],
        `${key}.kind must be "synonym" or "verb-noun".`,
      );
    }
  } else if (enabled) {
    addError(ctx, path, `${key} needs a kind: "synonym" or "verb-noun".`);
  }

  let variants: string[] | undefined;
  if (isSet(value, "variants")) {
    if (kind === "verb-noun") {
      addError(
        ctx,
        [...path, "variants"],
        `${key}.variants is only for the "synonym" kind. Use noun and verb instead.`,
      );
    } else {
      variants = checkWordList(ctx, value["variants"], [...path, "variants"]);
    }
  } else if (enabled && kind === "synonym") {
    addError(ctx, path, `${key} needs a variants list.`);
  }

  let noun: string | undefined;
  let verb: string | undefined;
  for (const name of ["noun", "verb"] as const) {
    const wordPath = [...path, name];
    let word: string | undefined;
    if (isSet(value, name)) {
      if (kind === "synonym") {
        addError(
          ctx,
          wordPath,
          `${formatKey(wordPath)} is only for the "verb-noun" kind. Use variants instead.`,
        );
      } else {
        word = checkWord(ctx, value[name], wordPath);
      }
    } else if (enabled && kind === "verb-noun") {
      addError(ctx, path, `${key} needs a ${name}.`);
    }
    if (name === "noun") {
      noun = word;
    } else {
      verb = word;
    }
  }
  if (
    noun !== undefined &&
    verb !== undefined &&
    normalizeWord(noun) === normalizeWord(verb)
  ) {
    addError(ctx, path, `${key}.noun and ${key}.verb must be different words.`);
  }

  if (id === undefined || ctx.errors.total > errorsBefore) {
    return LEFT_OUT;
  }
  if (!enabled) {
    return { group: undefined, disabledId: id };
  }
  if (kind === "synonym" && variants !== undefined) {
    return {
      group: Object.freeze({
        id,
        kind,
        variants: Object.freeze(variants),
        source,
      }),
      disabledId: undefined,
    };
  }
  if (kind === "verb-noun" && noun !== undefined && verb !== undefined) {
    return {
      group: Object.freeze({ id, kind, noun, verb, source }),
      disabledId: undefined,
    };
  }
  return LEFT_OUT;
}

function checkGroups(
  ctx: Checker,
  value: unknown,
): { groups: VariantGroup[]; disabled: string[] } {
  const groups: VariantGroup[] = [];
  const disabled: string[] = [];
  const path = ["groups"];
  if (!Array.isArray(value)) {
    addError(ctx, path, "groups must be a list of word groups.");
    return { groups, disabled };
  }
  // Check the length first, so a huge list is never looped over.
  if (value.length > MAX_ENTRIES) {
    addError(
      ctx,
      path,
      `groups must have from 0 to ${String(MAX_ENTRIES)} entries.`,
    );
    return { groups, disabled };
  }
  const seenIds = new Map<string, number>();
  for (let i = 0; i < value.length; i++) {
    const checked = checkGroup(ctx, value[i], i, seenIds);
    if (checked.group !== undefined) {
      groups.push(checked.group);
    }
    if (checked.disabledId !== undefined) {
      disabled.push(checked.disabledId);
    }
  }
  return { groups, disabled };
}

function checkRejected(ctx: Checker, value: unknown): RejectedGroup[] {
  const rejected: RejectedGroup[] = [];
  const path = ["rejected"];
  if (!Array.isArray(value)) {
    addError(ctx, path, "rejected must be a list of word groups.");
    return rejected;
  }
  // Check the length first, so a huge list is never looped over.
  if (value.length > MAX_ENTRIES) {
    addError(
      ctx,
      path,
      `rejected must have from 0 to ${String(MAX_ENTRIES)} entries.`,
    );
    return rejected;
  }
  const seen = new Set<string>();
  for (let i = 0; i < value.length; i++) {
    const entryPath = [...path, i];
    const entryKey = formatKey(entryPath);
    const entry: unknown = value[i];
    if (!isMap(entry)) {
      addError(
        ctx,
        entryPath,
        `${entryKey} must be a map with a variants list.`,
      );
      continue;
    }
    warnUnknownKeys(ctx, entry, REJECTED_KEYS, entryPath);
    if (!isSet(entry, "variants")) {
      addError(ctx, entryPath, `${entryKey} needs a variants list.`);
      continue;
    }
    const words = checkWordList(ctx, entry["variants"], [
      ...entryPath,
      "variants",
    ]);
    if (words === undefined) {
      continue;
    }
    const key = rejectedKey(words);
    if (seen.has(key)) {
      addIssue(ctx.warnings, {
        key: entryKey,
        line: ctx.lineOf?.(entryPath),
        message: `${entryKey} has the same words as an earlier rejected entry, so it is ignored.`,
      });
      continue;
    }
    seen.add(key);
    rejected.push(Object.freeze({ variants: Object.freeze(words) }));
  }
  return rejected;
}

function checkTopLevel(
  ctx: Checker,
  map: ConfigMap,
): { variants: TeamVariants; fileVersion: number | undefined } {
  warnUnknownKeys(ctx, map, TOP_KEYS, []);

  let fileVersion: number | undefined;
  const found = readFileVersion(map, VARIANTS_FORMAT_VERSION);
  if (found.status === "missing") {
    addIssue(ctx.warnings, {
      key: "version",
      line: undefined,
      message: MISSING_VERSION_MESSAGE,
    });
  } else if (found.status === "invalid") {
    addError(ctx, ["version"], INVALID_VERSION_MESSAGE);
  } else {
    fileVersion = found.version;
  }

  const { groups, disabled } = isSet(map, "groups")
    ? checkGroups(ctx, map["groups"])
    : { groups: [], disabled: [] };
  const rejected = isSet(map, "rejected")
    ? checkRejected(ctx, map["rejected"])
    : [];

  const variants: TeamVariants = Object.freeze({
    groups: Object.freeze(groups),
    disabled: Object.freeze(disabled),
    rejected: Object.freeze(rejected),
  });
  return { variants, fileVersion };
}

/** Checks parsed (untrusted) variants data. Never throws; bad entries are left out and reported. */
export function checkVariants(
  value: unknown,
  lineOf?: LineLookup,
): VariantsCheckResult {
  const ctx: Checker = {
    lineOf,
    errors: { kept: [], total: 0 },
    warnings: { kept: [], total: 0 },
  };

  let variants = EMPTY_TEAM_VARIANTS;
  let fileVersion: number | undefined;
  // null is an empty or comments-only file: nothing to check or warn about.
  if (isMap(value)) {
    const result = checkTopLevel(ctx, value);
    variants = result.variants;
    fileVersion = result.fileVersion;
  } else if (value !== null) {
    addError(
      ctx,
      [],
      "The file must be a list of settings, one `key: value` per line.",
    );
  }

  return {
    variants,
    fileVersion,
    errors: finishList(ctx.errors, "problems"),
    warnings: finishList(ctx.warnings, "warnings"),
  };
}
