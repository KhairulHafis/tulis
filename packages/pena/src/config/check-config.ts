import { isDocTypeName } from "../doc-types/doc-type-name.js";
import { findGlobProblem } from "../globs/glob.js";
import { isValidBranchName } from "../git/ref-name.js";
import { DEFAULT_CONFIG } from "./config-defaults.js";
import { CONFIG_FORMAT_VERSION } from "./config-types.js";
import type {
  ConfidenceWeights,
  ConfigIssue,
  ConfigPath,
  DocTypeRule,
  DocTypesConfig,
  LineLookup,
  TuningConfig,
  TulisConfig,
} from "./config-types.js";
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
import {
  MAX_MAX_FILE_SIZE,
  MIN_MAX_FILE_SIZE,
  parseFileSize,
} from "./file-size.js";

export interface ConfigCheckResult {
  readonly config: TulisConfig;
  /** The file's `version`, or undefined when it is missing or invalid. */
  readonly fileVersion: number | undefined;
  readonly errors: readonly ConfigIssue[];
  readonly warnings: readonly ConfigIssue[];
}

export { MAX_ISSUES } from "./issue-collector.js";

const TOP_KEYS = [
  "version",
  "prodBranch",
  "threshold",
  "minDocs",
  "maxFileSize",
  "include",
  "exclude",
  "defaultExcludes",
  "docTypes",
  "tuning",
] as const;
const DOC_TYPES_KEYS = ["frontmatterKey", "rules"] as const;
const RULE_KEYS = ["type", "include"] as const;
const TUNING_KEYS = [
  "docTypeMinDocs",
  "confidenceWeights",
  "historyMaxCommits",
  "bulkCommitMaxFiles",
  "templateMaxEditDistance",
  "recencyHalfLifeDays",
] as const;
const WEIGHT_KEYS = ["share", "docs", "recency", "history"] as const;

const MAX_GLOB_LENGTH = 500;
const MAX_COUNT = 1_000_000;
const MAX_RULES = 100;
const FRONTMATTER_KEY = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
const DRIVE_LETTER = /^[A-Za-z]:/;

/** The integer at `map[name]`, or `fallback` (with an error) when it is not one in range. */
function readInteger(
  ctx: Checker,
  map: ConfigMap,
  parent: ConfigPath,
  name: string,
  min: number,
  max: number,
  fallback: number,
): number {
  if (!isSet(map, name)) {
    return fallback;
  }
  const value = map[name];
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    if (value >= min && value <= max) {
      return value;
    }
  }
  const path = [...parent, name];
  addError(
    ctx,
    path,
    `${formatKey(path)} must be a whole number from ${String(min)} to ${String(max)}.`,
  );
  return fallback;
}

/** The finite number at `map[name]`, or `fallback` (with `message` as the error) when it is not one in range. */
function readNumber(
  ctx: Checker,
  map: ConfigMap,
  parent: ConfigPath,
  name: string,
  range: { readonly min: number; readonly max: number },
  fallback: number,
  message: string,
): number {
  if (!isSet(map, name)) {
    return fallback;
  }
  const value = map[name];
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= range.min &&
    value <= range.max
  ) {
    return value;
  }
  addError(ctx, [...parent, name], message);
  return fallback;
}

function isValidGlob(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  if (value.length < 1 || value.length > MAX_GLOB_LENGTH) {
    return false;
  }
  if (value.startsWith("/") || value.startsWith("!")) {
    return false;
  }
  if (DRIVE_LETTER.test(value) || value.includes("\\")) {
    return false;
  }
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      return false;
    }
  }
  return !value.split("/").includes("..");
}

/** A copy of the glob list `value`, or undefined (with errors) when it is not valid. `path` is where the list is in the file. */
function checkGlobList(
  ctx: Checker,
  value: unknown,
  path: ConfigPath,
  min: number,
  max: number,
): string[] | undefined {
  const key = formatKey(path);
  if (!Array.isArray(value)) {
    addError(ctx, path, `${key} must be a list of file patterns.`);
    return undefined;
  }
  // Check the length first, so a huge list is never looped over.
  if (value.length < min || value.length > max) {
    addError(
      ctx,
      path,
      `${key} must have from ${String(min)} to ${String(max)} patterns.`,
    );
    return undefined;
  }
  const globs: string[] = [];
  let allValid = true;
  for (let i = 0; i < value.length; i++) {
    const item: unknown = value[i];
    if (isValidGlob(item)) {
      if (findGlobProblem(item) === undefined) {
        globs.push(item);
      } else {
        allValid = false;
        const itemPath = [...path, i];
        addError(
          ctx,
          itemPath,
          `${formatKey(itemPath)} uses pattern syntax Tulis doesn't support: extended patterns such as \`+(a|b)\`, classes such as \`[[:alpha:]]\`, and reversed ranges such as \`[z-a]\`.`,
        );
      }
    } else {
      allValid = false;
      const itemPath = [...path, i];
      addError(
        ctx,
        itemPath,
        `${formatKey(itemPath)} must be a relative pattern using \`/\`, without \`..\`, a leading \`/\` or \`!\`, or a backslash, up to 500 characters.`,
      );
    }
  }
  return allValid ? globs : undefined;
}

/** The glob list at `map[name]`, or `fallback` when it is missing or invalid. */
function readGlobList(
  ctx: Checker,
  map: ConfigMap,
  name: string,
  min: number,
  max: number,
  fallback: readonly string[],
): readonly string[] {
  if (!isSet(map, name)) {
    return fallback;
  }
  const globs = checkGlobList(ctx, map[name], [name], min, max);
  return globs === undefined ? fallback : Object.freeze(globs);
}

function checkWeights(
  ctx: Checker,
  value: unknown,
  path: ConfigPath,
): ConfidenceWeights {
  const defaults = DEFAULT_CONFIG.tuning.confidenceWeights;
  if (!isMap(value)) {
    addError(ctx, path, "tuning.confidenceWeights must be a map of weights.");
    return defaults;
  }
  warnUnknownKeys(ctx, value, WEIGHT_KEYS, path);
  const read = (name: (typeof WEIGHT_KEYS)[number]): number =>
    readNumber(
      ctx,
      value,
      path,
      name,
      { min: 0, max: 1 },
      defaults[name],
      `tuning.confidenceWeights.${name} must be a number from 0 to 1.`,
    );
  const weights = {
    share: read("share"),
    docs: read("docs"),
    recency: read("recency"),
    history: read("history"),
  };
  if (weights.share + weights.docs + weights.recency + weights.history === 0) {
    addError(
      ctx,
      path,
      "tuning.confidenceWeights needs at least one weight above 0.",
    );
    return defaults;
  }
  return Object.freeze(weights);
}

function checkTuning(
  ctx: Checker,
  value: unknown,
  path: ConfigPath,
): TuningConfig {
  const defaults = DEFAULT_CONFIG.tuning;
  if (!isMap(value)) {
    addError(ctx, path, "tuning must be a map of settings.");
    return defaults;
  }
  warnUnknownKeys(ctx, value, TUNING_KEYS, path);
  return Object.freeze({
    docTypeMinDocs: readInteger(
      ctx,
      value,
      path,
      "docTypeMinDocs",
      1,
      MAX_COUNT,
      defaults.docTypeMinDocs,
    ),
    confidenceWeights: isSet(value, "confidenceWeights")
      ? checkWeights(ctx, value["confidenceWeights"], [
          ...path,
          "confidenceWeights",
        ])
      : defaults.confidenceWeights,
    historyMaxCommits: readInteger(
      ctx,
      value,
      path,
      "historyMaxCommits",
      1,
      MAX_COUNT,
      defaults.historyMaxCommits,
    ),
    bulkCommitMaxFiles: readInteger(
      ctx,
      value,
      path,
      "bulkCommitMaxFiles",
      1,
      MAX_COUNT,
      defaults.bulkCommitMaxFiles,
    ),
    templateMaxEditDistance: readInteger(
      ctx,
      value,
      path,
      "templateMaxEditDistance",
      1,
      5,
      defaults.templateMaxEditDistance,
    ),
    recencyHalfLifeDays: readInteger(
      ctx,
      value,
      path,
      "recencyHalfLifeDays",
      1,
      36_500,
      defaults.recencyHalfLifeDays,
    ),
  });
}

/** One rule, or undefined (with errors) when it is not valid. `path` ends with the rule's 0-based position. */
function checkRule(
  ctx: Checker,
  value: unknown,
  path: ConfigPath,
): DocTypeRule | undefined {
  const ruleKey = formatKey(path);
  if (!isMap(value)) {
    addError(ctx, path, `${ruleKey} must be a map with type and include.`);
    return undefined;
  }
  warnUnknownKeys(ctx, value, RULE_KEYS, path);

  let type: string | undefined;
  if (!isSet(value, "type")) {
    addError(ctx, path, `${ruleKey} needs a type.`);
  } else {
    const rawType = value["type"];
    if (typeof rawType === "string" && isDocTypeName(rawType)) {
      type = rawType;
    } else {
      addError(
        ctx,
        [...path, "type"],
        `${ruleKey}.type must be a name of letters, digits, spaces, \`_\` or \`-\`, up to 64 characters.`,
      );
    }
  }

  let include: string[] | undefined;
  if (!isSet(value, "include")) {
    addError(ctx, path, `${ruleKey} needs an include list.`);
  } else {
    include = checkGlobList(ctx, value["include"], [...path, "include"], 1, 50);
  }

  if (type === undefined || include === undefined) {
    return undefined;
  }
  return Object.freeze({ type, include: Object.freeze(include) });
}

function checkRules(
  ctx: Checker,
  value: unknown,
  path: ConfigPath,
): readonly DocTypeRule[] {
  const fallback = DEFAULT_CONFIG.docTypes.rules;
  if (!Array.isArray(value)) {
    addError(ctx, path, "docTypes.rules must be a list of rules.");
    return fallback;
  }
  // Check the length first, so a huge list is never looped over.
  if (value.length > MAX_RULES) {
    addError(
      ctx,
      path,
      `docTypes.rules must have from 0 to ${String(MAX_RULES)} rules.`,
    );
    return fallback;
  }
  const rules: DocTypeRule[] = [];
  let allValid = true;
  for (let i = 0; i < value.length; i++) {
    const rule = checkRule(ctx, value[i], [...path, i]);
    if (rule === undefined) {
      allValid = false;
    } else {
      rules.push(rule);
    }
  }
  return allValid ? Object.freeze(rules) : fallback;
}

function checkDocTypes(
  ctx: Checker,
  value: unknown,
  path: ConfigPath,
): DocTypesConfig {
  const defaults = DEFAULT_CONFIG.docTypes;
  if (!isMap(value)) {
    addError(ctx, path, "docTypes must be a map of settings.");
    return defaults;
  }
  warnUnknownKeys(ctx, value, DOC_TYPES_KEYS, path);

  let frontmatterKey = defaults.frontmatterKey;
  if (isSet(value, "frontmatterKey")) {
    const raw = value["frontmatterKey"];
    if (typeof raw === "string" && FRONTMATTER_KEY.test(raw)) {
      frontmatterKey = raw;
    } else {
      addError(
        ctx,
        [...path, "frontmatterKey"],
        "docTypes.frontmatterKey must be a frontmatter key name: letters, digits, `_` or `-`, starting with a letter or `_`, up to 64 characters.",
      );
    }
  }

  const rules = isSet(value, "rules")
    ? checkRules(ctx, value["rules"], [...path, "rules"])
    : defaults.rules;
  return Object.freeze({ frontmatterKey, rules });
}

/** Checks the top-level map. Returns the config and the file's version. */
function checkTopLevel(
  ctx: Checker,
  map: ConfigMap,
): { config: TulisConfig; fileVersion: number | undefined } {
  const defaults = DEFAULT_CONFIG;
  warnUnknownKeys(ctx, map, TOP_KEYS, []);

  let fileVersion: number | undefined;
  const found = readFileVersion(map, CONFIG_FORMAT_VERSION);
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

  let prodBranch = defaults.prodBranch;
  if (isSet(map, "prodBranch")) {
    const raw = map["prodBranch"];
    if (typeof raw === "string" && isValidBranchName(raw)) {
      prodBranch = raw;
    } else {
      addError(
        ctx,
        ["prodBranch"],
        "prodBranch must be a valid git branch name.",
      );
    }
  }

  const threshold = readNumber(
    ctx,
    map,
    [],
    "threshold",
    { min: 0.5, max: 1 },
    defaults.threshold,
    "threshold must be a number from 0.5 to 1, for example 0.8 for 80%.",
  );
  const minDocs = readInteger(
    ctx,
    map,
    [],
    "minDocs",
    1,
    MAX_COUNT,
    defaults.minDocs,
  );

  let maxFileSize = defaults.maxFileSize;
  if (isSet(map, "maxFileSize")) {
    const bytes = parseFileSize(map["maxFileSize"]);
    if (bytes === undefined) {
      addError(
        ctx,
        ["maxFileSize"],
        "maxFileSize must be a size such as 1MB or 500KB, or a whole number of bytes.",
      );
    } else if (bytes < MIN_MAX_FILE_SIZE || bytes > MAX_MAX_FILE_SIZE) {
      addError(ctx, ["maxFileSize"], "maxFileSize must be from 1KB to 10MB.");
    } else {
      maxFileSize = bytes;
    }
  }

  const include = readGlobList(ctx, map, "include", 1, 200, defaults.include);
  const exclude = readGlobList(ctx, map, "exclude", 0, 200, defaults.exclude);

  let defaultExcludes = defaults.defaultExcludes;
  if (isSet(map, "defaultExcludes")) {
    const raw = map["defaultExcludes"];
    if (typeof raw === "boolean") {
      defaultExcludes = raw;
    } else {
      addError(
        ctx,
        ["defaultExcludes"],
        "defaultExcludes must be true or false.",
      );
    }
  }

  const docTypes = isSet(map, "docTypes")
    ? checkDocTypes(ctx, map["docTypes"], ["docTypes"])
    : defaults.docTypes;
  const tuning = isSet(map, "tuning")
    ? checkTuning(ctx, map["tuning"], ["tuning"])
    : defaults.tuning;

  const config: TulisConfig = Object.freeze({
    prodBranch,
    threshold,
    minDocs,
    maxFileSize,
    include,
    exclude,
    defaultExcludes,
    docTypes,
    tuning,
  });
  return { config, fileVersion };
}

/** Checks parsed (untrusted) config data. Never throws; bad values become defaults plus an issue. */
export function checkConfig(
  value: unknown,
  lineOf?: LineLookup,
): ConfigCheckResult {
  const ctx: Checker = {
    lineOf,
    errors: { kept: [], total: 0 },
    warnings: { kept: [], total: 0 },
  };

  let config = DEFAULT_CONFIG;
  let fileVersion: number | undefined;
  if (value === null || isMap(value)) {
    const result = checkTopLevel(ctx, value ?? {});
    config = result.config;
    fileVersion = result.fileVersion;
  } else {
    addError(
      ctx,
      [],
      "The file must be a list of settings, one `key: value` per line.",
    );
  }

  return {
    config,
    fileVersion,
    errors: finishList(ctx.errors, "problems"),
    warnings: finishList(ctx.warnings, "warnings"),
  };
}
