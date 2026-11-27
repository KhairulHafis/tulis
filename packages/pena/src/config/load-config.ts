import { checkConfig } from "./check-config.js";
import { DEFAULT_CONFIG } from "./config-defaults.js";
import { CONFIG_FORMAT_VERSION } from "./config-types.js";
import type { ConfigIssue, TulisConfig } from "./config-types.js";
import { YamlParseError, parseYaml } from "./parse-yaml.js";
import type { ParsedYaml } from "./parse-yaml.js";
import { TeamFileError, readTeamFile } from "./team-file.js";
import type { TeamFileRead } from "./team-file.js";
import { TeamFileUseError, formatTeamIssue } from "./team-issue.js";

/** Where the team config lives, relative to the repo root. Shown in messages. */
export const CONFIG_FILE = ".tulis/config.yaml";
export const MAX_CONFIG_BYTES = 64 * 1024;

export interface LoadedConfig {
  readonly config: TulisConfig;
  /** "defaults" when there is no config file. */
  readonly source: "file" | "defaults";
  /** Writer-ready lines, each starting with CONFIG_FILE. */
  readonly warnings: readonly string[];
}

/** ".tulis/config.yaml line 4: <message>" or ".tulis/config.yaml: <message>". */
export function formatIssue(issue: ConfigIssue): string {
  return formatTeamIssue(CONFIG_FILE, issue);
}

/** The config file could not be used. The CLI maps this to exit code 2. */
export class ConfigError extends TeamFileUseError {
  constructor(
    issues: readonly ConfigIssue[],
    warnings: readonly ConfigIssue[] = [],
  ) {
    super(CONFIG_FILE, issues, warnings);
    this.name = "ConfigError";
  }
}

function fail(message: string, line?: number): ConfigError {
  return new ConfigError([{ key: "", line, message }]);
}

/** Finds, safely reads, parses and checks `.tulis/config.yaml` in a repo. */
export async function loadConfig(repoRoot: string): Promise<LoadedConfig> {
  let read: TeamFileRead;
  try {
    read = await readTeamFile(repoRoot, ["config.yaml"], MAX_CONFIG_BYTES);
  } catch (error) {
    if (error instanceof TeamFileError) {
      throw fail(error.reason);
    }
    throw error;
  }
  if (read.kind === "missing") {
    return { config: DEFAULT_CONFIG, source: "defaults", warnings: [] };
  }
  const text = read.text;

  let parsed: ParsedYaml;
  try {
    parsed = parseYaml(text, { maxBytes: MAX_CONFIG_BYTES });
  } catch (error) {
    if (error instanceof YamlParseError) {
      throw fail(`Not valid YAML: ${error.reason}`, error.line);
    }
    throw error;
  }

  const result = checkConfig(parsed.value, parsed.lineOf);
  if (
    result.fileVersion !== undefined &&
    result.fileVersion > CONFIG_FORMAT_VERSION
  ) {
    return {
      config: result.config,
      source: "file",
      warnings: [
        formatIssue({
          key: "version",
          line: parsed.lineOf(["version"]),
          message: `This file was made by a newer version of Tulis (file version ${String(result.fileVersion)}). Please upgrade Tulis. Settings this version can't use fall back to their defaults.`,
        }),
      ],
    };
  }
  if (result.errors.length > 0) {
    throw new ConfigError(result.errors, result.warnings);
  }
  return {
    config: result.config,
    source: "file",
    warnings: result.warnings.map(formatIssue),
  };
}
