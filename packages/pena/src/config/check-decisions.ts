import type { ConfigPath, LineLookup } from "./config-types.js";
import { DECISIONS_FORMAT_VERSION } from "./decisions-types.js";
import type { Dismissal } from "./decisions-types.js";
import {
  INVALID_VERSION_MESSAGE,
  MISSING_VERSION_MESSAGE,
  readFileVersion,
} from "./file-version.js";
import {
  addError,
  addIssue,
  finishList,
  isMap,
  isSet,
  warnUnknownKeys,
} from "./issue-collector.js";
import type { Checker, ConfigMap } from "./issue-collector.js";
import type { TeamIssue } from "./team-issue.js";

export interface DecisionsCheckResult {
  /** Frozen. Entries with errors are left out. File order. */
  readonly dismissals: readonly Dismissal[];
  /** The file's `version`: set for supported and newer versions. */
  readonly fileVersion: number | undefined;
  /** Bad entries. The loader turns these into warnings. */
  readonly errors: readonly TeamIssue[];
  readonly warnings: readonly TeamIssue[];
}

const TOP_KEYS = ["version", "dismissals"] as const;
const ENTRY_KEYS = ["check", "count", "last"] as const;

const MAX_ENTRIES = 1000;
const MAX_CHECK_LENGTH = 128;
const MIN_CHECK_PARTS = 2;
const MAX_CHECK_PARTS = 4;
const MAX_COUNT = 1_000_000;
const MIN_YEAR = 2000;
const MAX_YEAR = 2999;
const CHECK_PART = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const CHECK_MESSAGE = `must be a check ID of ${String(MIN_CHECK_PARTS)} to ${String(MAX_CHECK_PARTS)} parts joined by dots, such as term.sign-in (lower-case letters, digits and hyphens, at most ${String(MAX_CHECK_LENGTH)} characters).`;
const COUNT_MESSAGE = `must be a whole number from 1 to ${MAX_COUNT.toLocaleString("en-US")}.`;
const LAST_MESSAGE = `must be a day written as YYYY-MM-DD, such as "2026-11-27", with a year from ${String(MIN_YEAR)} to ${String(MAX_YEAR)} and no time.`;

function isCheckId(value: string): boolean {
  if (value.length > MAX_CHECK_LENGTH) {
    return false;
  }
  const parts = value.split(".");
  return (
    parts.length >= MIN_CHECK_PARTS &&
    parts.length <= MAX_CHECK_PARTS &&
    parts.every((part) => CHECK_PART.test(part))
  );
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function isDay(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return (
    year >= MIN_YEAR &&
    year <= MAX_YEAR &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month)
  );
}

/** Reads one entry. Returns undefined (after recording errors) when it is bad. */
function readEntry(
  ctx: Checker,
  raw: unknown,
  path: ConfigPath,
): Dismissal | undefined {
  if (!isMap(raw)) {
    addError(
      ctx,
      path,
      "Each dismissal must have check, count and last, one `key: value` per line.",
    );
    return undefined;
  }
  warnUnknownKeys(ctx, raw, ENTRY_KEYS, path);

  const check = readField(ctx, raw, path, "check");
  const count = readField(ctx, raw, path, "count");
  const last = readField(ctx, raw, path, "last");
  if (
    typeof check === "string" &&
    isCheckId(check) &&
    typeof count === "number" &&
    Number.isSafeInteger(count) &&
    count >= 1 &&
    count <= MAX_COUNT &&
    typeof last === "string" &&
    isDay(last)
  ) {
    return Object.freeze({ check, count, last });
  }
  return undefined;
}

/** The field's value, with an error recorded when it is missing or not valid. */
function readField(
  ctx: Checker,
  entry: ConfigMap,
  path: ConfigPath,
  name: (typeof ENTRY_KEYS)[number],
): unknown {
  const fieldPath = [...path, name];
  if (!isSet(entry, name)) {
    addError(ctx, fieldPath, `${name} is required.`);
    return undefined;
  }
  const value = entry[name];
  let message: string | undefined;
  if (name === "check") {
    if (typeof value !== "string" || !isCheckId(value)) {
      message = `${name} ${CHECK_MESSAGE}`;
    }
  } else if (name === "count") {
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > MAX_COUNT
    ) {
      message = `${name} ${COUNT_MESSAGE}`;
    }
  } else if (typeof value !== "string" || !isDay(value)) {
    message = `${name} ${LAST_MESSAGE}`;
  }
  if (message !== undefined) {
    addError(ctx, fieldPath, message);
    return undefined;
  }
  return value;
}

function checkList(ctx: Checker, map: ConfigMap): readonly Dismissal[] {
  if (!isSet(map, "dismissals")) {
    return [];
  }
  const raw = map["dismissals"];
  if (!Array.isArray(raw)) {
    addError(ctx, ["dismissals"], "dismissals must be a list.");
    return [];
  }
  if (raw.length > MAX_ENTRIES) {
    addError(
      ctx,
      ["dismissals"],
      `dismissals can have at most ${String(MAX_ENTRIES)} entries, so none were used.`,
    );
    return [];
  }

  const kept: Dismissal[] = [];
  const firstIndex = new Map<string, number>();
  for (const [index, item] of (raw as readonly unknown[]).entries()) {
    const path = ["dismissals", index];
    const entry = readEntry(ctx, item, path);
    if (entry === undefined) {
      continue;
    }
    const earlier = firstIndex.get(entry.check);
    if (earlier !== undefined) {
      const line = ctx.lineOf?.(["dismissals", earlier]);
      addError(
        ctx,
        [...path, "check"],
        line === undefined
          ? "This check is already listed earlier in the file, so this entry was skipped."
          : `This check is already listed on line ${String(line)}, so this entry was skipped.`,
      );
      continue;
    }
    firstIndex.set(entry.check, index);
    kept.push(entry);
  }
  return kept;
}

function checkTopLevel(
  ctx: Checker,
  map: ConfigMap,
): { dismissals: readonly Dismissal[]; fileVersion: number | undefined } {
  warnUnknownKeys(ctx, map, TOP_KEYS, []);

  let fileVersion: number | undefined;
  const found = readFileVersion(map, DECISIONS_FORMAT_VERSION);
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

  return { dismissals: checkList(ctx, map), fileVersion };
}

/** Checks parsed (untrusted) decisions data. Never throws; bad entries are left out and reported. */
export function checkDecisions(
  value: unknown,
  lineOf?: LineLookup,
): DecisionsCheckResult {
  const ctx: Checker = {
    lineOf,
    errors: { kept: [], total: 0 },
    warnings: { kept: [], total: 0 },
  };

  let dismissals: readonly Dismissal[] = [];
  let fileVersion: number | undefined;
  if (value === null) {
    // An empty or comments-only file: nothing to check, nothing to warn about.
  } else if (isMap(value)) {
    const result = checkTopLevel(ctx, value);
    dismissals = result.dismissals;
    fileVersion = result.fileVersion;
  } else {
    addError(
      ctx,
      [],
      "The file must be a list of settings, one `key: value` per line.",
    );
  }

  return {
    dismissals: Object.freeze([...dismissals]),
    fileVersion,
    errors: finishList(ctx.errors, "problems"),
    warnings: finishList(ctx.warnings, "warnings"),
  };
}
