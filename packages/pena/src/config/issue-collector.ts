import { toSafeText } from "../git/safe-text.js";
import { closestKey } from "./closest-key.js";
import type { ConfigIssue, ConfigPath, LineLookup } from "./config-types.js";

/** Most errors, and most warnings, kept from one file. */
export const MAX_ISSUES = 20;

export type ConfigMap = Record<string, unknown>;

/** Collects issues of one kind and keeps only the first MAX_ISSUES. */
export interface IssueList {
  readonly kept: ConfigIssue[];
  total: number;
}

export interface Checker {
  readonly lineOf: LineLookup | undefined;
  readonly errors: IssueList;
  readonly warnings: IssueList;
}

export function isMap(value: unknown): value is ConfigMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when the map has its own `name` key with a value other than null (null means "not set"). */
export function isSet(map: ConfigMap, name: string): boolean {
  return Object.hasOwn(map, name) && map[name] !== null;
}

/** "docTypes.rules[2].include": list positions are shown 1-based. */
export function formatKey(path: ConfigPath): string {
  let key = "";
  for (const part of path) {
    if (typeof part === "number") {
      key += `[${String(part + 1)}]`;
    } else {
      key += key === "" ? part : `.${part}`;
    }
  }
  return key;
}

export function addIssue(list: IssueList, issue: ConfigIssue): void {
  list.total += 1;
  if (list.kept.length < MAX_ISSUES) {
    list.kept.push(issue);
  }
}

export function finishList(list: IssueList, noun: string): ConfigIssue[] {
  const result = [...list.kept];
  if (list.total > MAX_ISSUES) {
    result.push({
      key: "",
      line: undefined,
      message: `${String(list.total - MAX_ISSUES)} more ${noun} not shown.`,
    });
  }
  return result;
}

/** Records an error for the setting at `path`. */
export function addError(
  ctx: Checker,
  path: ConfigPath,
  message: string,
): void {
  addIssue(ctx.errors, {
    key: formatKey(path),
    line: ctx.lineOf?.(path),
    message,
  });
}

/** Warns about each key in `map` that is not in `known`. */
export function warnUnknownKeys(
  ctx: Checker,
  map: ConfigMap,
  known: readonly string[],
  path: ConfigPath,
): void {
  const parentKey = formatKey(path);
  for (const name of Object.keys(map)) {
    if (known.includes(name)) {
      continue;
    }
    const safe = toSafeText(name, { maxLength: 60 });
    const suggestion = closestKey(name, known);
    const hint =
      suggestion === undefined ? "" : ` Did you mean "${suggestion}"?`;
    addIssue(ctx.warnings, {
      key: parentKey === "" ? safe : `${parentKey}.${safe}`,
      line: ctx.lineOf?.([...path, name]),
      message: `Unknown key "${safe}" is ignored.${hint}`,
    });
  }
}
