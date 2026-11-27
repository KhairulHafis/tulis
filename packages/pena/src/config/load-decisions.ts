import { toSafeText } from "../git/safe-text.js";
import { checkDecisions } from "./check-decisions.js";
import type { DecisionsCheckResult } from "./check-decisions.js";
import {
  DECISIONS_FOLDER,
  DECISIONS_FORMAT_VERSION,
} from "./decisions-types.js";
import type { WriterDecisions } from "./decisions-types.js";
import { newerVersionMessage } from "./file-version.js";
import { YamlParseError, parseYamlDocument } from "./parse-yaml.js";
import type { ParsedYamlDocument } from "./parse-yaml.js";
import { TeamFileError, listTeamFiles, readTeamFile } from "./team-file.js";
import type { TeamFileRead } from "./team-file.js";
import { formatTeamIssue } from "./team-issue.js";
import type { TeamIssue } from "./team-issue.js";
import { isDecisionsFileName } from "./writer-file.js";

/** Where the writers' dismissals live, relative to the repo root. Shown in messages. */
export const DECISIONS_FILE_PREFIX = ".tulis/decisions/";
export const MAX_DECISIONS_BYTES = 64 * 1024;
export const MAX_DECISIONS_FILES = 500;
export const MAX_DECISIONS_WARNINGS = 50;

export interface LoadedDecisions {
  /** Sorted by fileName. Files that were skipped whole are left out. */
  readonly writers: readonly WriterDecisions[];
  /** Writer-ready lines, each starting with ".tulis/decisions/<fileName>". */
  readonly warnings: readonly string[];
}

export interface DecisionsFile {
  readonly fileName: string;
  /** null when the file is missing. */
  readonly text: string | null;
  /** undefined when the file is missing or not valid YAML. */
  readonly parsed: ParsedYamlDocument | undefined;
  /** An empty result when the file is missing. */
  readonly check: DecisionsCheckResult;
  /** Present when Tulis must not write this file: one plain sentence, safe to show. */
  readonly writeBlocked: string | undefined;
}

const NOT_YAML_BLOCK = "The file is not valid YAML, so Tulis won't change it.";
const ERRORS_BLOCK =
  "The file has errors, so Tulis won't change it. Fix them first.";
const NEWER_BLOCK =
  "The file was made by a newer version of Tulis, so this version won't change it. Please upgrade Tulis.";
const BAD_NAME_MESSAGE =
  "This file name was not made by Tulis, so it was skipped.";

const EMPTY_CHECK: DecisionsCheckResult = Object.freeze({
  dismissals: Object.freeze([]),
  fileVersion: undefined,
  errors: Object.freeze([]),
  warnings: Object.freeze([]),
});

type FileRead =
  | { readonly kind: "missing" }
  | { readonly kind: "read-failed"; readonly reason: string }
  | {
      readonly kind: "not-yaml";
      readonly text: string;
      readonly reason: string;
      readonly issue: TeamIssue;
    }
  | {
      readonly kind: "checked";
      readonly text: string;
      readonly parsed: ParsedYamlDocument;
      readonly check: DecisionsCheckResult;
    };

function isNewer(check: DecisionsCheckResult): boolean {
  return (
    check.fileVersion !== undefined &&
    check.fileVersion > DECISIONS_FORMAT_VERSION
  );
}

async function readAndCheck(
  repoRoot: string,
  fileName: string,
): Promise<FileRead> {
  let read: TeamFileRead;
  try {
    read = await readTeamFile(
      repoRoot,
      [DECISIONS_FOLDER, fileName],
      MAX_DECISIONS_BYTES,
    );
  } catch (error) {
    if (error instanceof TeamFileError) {
      return { kind: "read-failed", reason: error.reason };
    }
    throw error;
  }
  if (read.kind === "missing") {
    return { kind: "missing" };
  }
  const text = read.text;

  let parsed: ParsedYamlDocument;
  try {
    parsed = parseYamlDocument(text, { maxBytes: MAX_DECISIONS_BYTES });
  } catch (error) {
    if (error instanceof YamlParseError) {
      return {
        kind: "not-yaml",
        text,
        reason: error.reason,
        issue: {
          key: "",
          line: error.line,
          message: `Not valid YAML: ${error.reason}`,
        },
      };
    }
    throw error;
  }
  return {
    kind: "checked",
    text,
    parsed,
    check: checkDecisions(parsed.value, parsed.lineOf),
  };
}

/** Reads and checks one writer's file, for a later writer. A read failure is reported in writeBlocked, not thrown. */
export async function readDecisionsFile(
  repoRoot: string,
  fileName: string,
): Promise<DecisionsFile> {
  if (!isDecisionsFileName(fileName)) {
    throw new TypeError("fileName is not a decisions file name");
  }
  const result = await readAndCheck(repoRoot, fileName);
  switch (result.kind) {
    case "missing":
      return {
        fileName,
        text: null,
        parsed: undefined,
        check: EMPTY_CHECK,
        writeBlocked: undefined,
      };
    case "read-failed":
      return {
        fileName,
        text: null,
        parsed: undefined,
        check: EMPTY_CHECK,
        writeBlocked: result.reason,
      };
    case "not-yaml":
      return {
        fileName,
        text: result.text,
        parsed: undefined,
        check: { ...EMPTY_CHECK, errors: [result.issue] },
        writeBlocked: NOT_YAML_BLOCK,
      };
    case "checked": {
      let writeBlocked: string | undefined;
      if (isNewer(result.check)) {
        writeBlocked = NEWER_BLOCK;
      } else if (result.check.errors.length > 0) {
        writeBlocked = ERRORS_BLOCK;
      }
      return {
        fileName,
        text: result.text,
        parsed: result.parsed,
        check: result.check,
        writeBlocked,
      };
    }
  }
}

function formatFor(fileName: string, issue: TeamIssue): string {
  return formatTeamIssue(
    `${DECISIONS_FILE_PREFIX}${toSafeText(fileName)}`,
    issue,
  );
}

function capWarnings(warnings: readonly string[]): readonly string[] {
  if (warnings.length <= MAX_DECISIONS_WARNINGS) {
    return warnings;
  }
  return [
    ...warnings.slice(0, MAX_DECISIONS_WARNINGS),
    `${String(warnings.length - MAX_DECISIONS_WARNINGS)} more warnings not shown.`,
  ];
}

/** Loads every writer's dismissals. A bad file or entry is skipped with a warning; nothing in the folder stops Tulis. */
export async function loadDecisions(
  repoRoot: string,
): Promise<LoadedDecisions> {
  let names: readonly string[];
  try {
    names = await listTeamFiles(repoRoot, [DECISIONS_FOLDER], {
      extension: ".yaml",
      maxFiles: MAX_DECISIONS_FILES,
    });
  } catch (error) {
    if (error instanceof TeamFileError) {
      return {
        writers: [],
        warnings: [
          formatTeamIssue(DECISIONS_FILE_PREFIX, {
            key: "",
            line: undefined,
            message: error.reason,
          }),
        ],
      };
    }
    throw error;
  }

  const writers: WriterDecisions[] = [];
  const warnings: string[] = [];
  for (const fileName of [...names].sort()) {
    if (!isDecisionsFileName(fileName)) {
      warnings.push(
        formatFor(fileName, {
          key: "",
          line: undefined,
          message: BAD_NAME_MESSAGE,
        }),
      );
      continue;
    }
    const result = await readAndCheck(repoRoot, fileName);
    if (result.kind === "missing") {
      continue;
    }
    if (result.kind === "read-failed") {
      warnings.push(
        formatFor(fileName, {
          key: "",
          line: undefined,
          message: `${result.reason} The file was skipped.`,
        }),
      );
      continue;
    }
    if (result.kind === "not-yaml") {
      warnings.push(
        formatFor(fileName, {
          ...result.issue,
          message: `The file is not valid YAML, so it was skipped: ${result.reason}`,
        }),
      );
      continue;
    }

    const { check, parsed } = result;
    writers.push({ fileName, dismissals: check.dismissals });
    if (isNewer(check) && check.fileVersion !== undefined) {
      warnings.push(
        formatFor(fileName, {
          key: "version",
          line: parsed.lineOf(["version"]),
          message: `${newerVersionMessage(check.fileVersion)} Entries this version can't use are skipped.`,
        }),
      );
      continue;
    }
    for (const issue of [...check.errors, ...check.warnings]) {
      warnings.push(formatFor(fileName, issue));
    }
  }

  return { writers, warnings: capWarnings(warnings) };
}
