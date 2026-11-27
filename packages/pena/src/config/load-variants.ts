import { newerVersionMessage } from "./file-version.js";
import { YamlParseError, parseYamlDocument } from "./parse-yaml.js";
import type { ParsedYamlDocument } from "./parse-yaml.js";
import { TeamFileError, readTeamFile } from "./team-file.js";
import type { TeamFileRead } from "./team-file.js";
import { TeamFileUseError, formatTeamIssue } from "./team-issue.js";
import { checkVariants } from "./check-variants.js";
import type { VariantsCheckResult } from "./check-variants.js";
import {
  EMPTY_TEAM_VARIANTS,
  VARIANTS_FORMAT_VERSION,
} from "./variants-types.js";
import type { TeamVariants } from "./variants-types.js";

/** Where the team word groups live, relative to the repo root. Shown in messages. */
export const VARIANTS_FILE = ".tulis/variants.yaml";
export const MAX_VARIANTS_BYTES = 256 * 1024;

export interface LoadedVariants {
  /** EMPTY_TEAM_VARIANTS when there is no file. */
  readonly variants: TeamVariants;
  readonly source: "file" | "none";
  /** Writer-ready lines, each starting with VARIANTS_FILE. */
  readonly warnings: readonly string[];
}

/** Everything a writer needs. */
export interface VariantsFile {
  /** null when the file is missing. */
  readonly text: string | null;
  /** undefined when the file is missing or not valid YAML. */
  readonly parsed: ParsedYamlDocument | undefined;
  /** An empty result when the file is missing. */
  readonly check: VariantsCheckResult;
  /** Present when Tulis must not write this file: one plain sentence, safe to show. */
  readonly writeBlocked: string | undefined;
}

const NOT_YAML_BLOCK = "The file is not valid YAML, so Tulis won't change it.";
const ERRORS_BLOCK =
  "The file has errors, so Tulis won't change it. Fix them first.";
const NEWER_BLOCK =
  "The file was made by a newer version of Tulis, so this version won't change it. Please upgrade Tulis.";

const EMPTY_CHECK: VariantsCheckResult = Object.freeze({
  variants: EMPTY_TEAM_VARIANTS,
  fileVersion: undefined,
  errors: Object.freeze([]),
  warnings: Object.freeze([]),
});

function isNewer(check: VariantsCheckResult): boolean {
  return (
    check.fileVersion !== undefined &&
    check.fileVersion > VARIANTS_FORMAT_VERSION
  );
}

/** Finds, safely reads, parses and checks `.tulis/variants.yaml`. Problems in the file are reported in the result, not thrown. */
export async function readVariantsFile(
  repoRoot: string,
): Promise<VariantsFile> {
  let read: TeamFileRead;
  try {
    read = await readTeamFile(repoRoot, ["variants.yaml"], MAX_VARIANTS_BYTES);
  } catch (error) {
    if (error instanceof TeamFileError) {
      throw new TeamFileUseError(VARIANTS_FILE, [
        { key: "", line: undefined, message: error.reason },
      ]);
    }
    throw error;
  }
  if (read.kind === "missing") {
    return {
      text: null,
      parsed: undefined,
      check: EMPTY_CHECK,
      writeBlocked: undefined,
    };
  }
  const text = read.text;

  let parsed: ParsedYamlDocument;
  try {
    parsed = parseYamlDocument(text, { maxBytes: MAX_VARIANTS_BYTES });
  } catch (error) {
    if (error instanceof YamlParseError) {
      return {
        text,
        parsed: undefined,
        check: {
          ...EMPTY_CHECK,
          errors: [
            {
              key: "",
              line: error.line,
              message: `Not valid YAML: ${error.reason}`,
            },
          ],
        },
        writeBlocked: NOT_YAML_BLOCK,
      };
    }
    throw error;
  }

  const check = checkVariants(parsed.value, parsed.lineOf);
  let writeBlocked: string | undefined;
  if (isNewer(check)) {
    writeBlocked = NEWER_BLOCK;
  } else if (check.errors.length > 0) {
    writeBlocked = ERRORS_BLOCK;
  }
  return { text, parsed, check, writeBlocked };
}

/** Loads the team word groups. Throws TeamFileUseError when the file can't be used. */
export async function loadVariants(repoRoot: string): Promise<LoadedVariants> {
  const file = await readVariantsFile(repoRoot);
  if (file.text === null) {
    return { variants: EMPTY_TEAM_VARIANTS, source: "none", warnings: [] };
  }
  const { check, parsed } = file;
  if (parsed === undefined) {
    throw new TeamFileUseError(VARIANTS_FILE, check.errors);
  }
  if (isNewer(check) && check.fileVersion !== undefined) {
    return {
      variants: check.variants,
      source: "file",
      warnings: [
        formatTeamIssue(VARIANTS_FILE, {
          key: "version",
          line: parsed.lineOf(["version"]),
          message: `${newerVersionMessage(check.fileVersion)} Entries this version can't use are skipped.`,
        }),
      ],
    };
  }
  if (check.errors.length > 0) {
    throw new TeamFileUseError(VARIANTS_FILE, check.errors, check.warnings);
  }
  return {
    variants: check.variants,
    source: "file",
    warnings: check.warnings.map((issue) =>
      formatTeamIssue(VARIANTS_FILE, issue),
    ),
  };
}
