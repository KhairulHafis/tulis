import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { checkConfig } from "./check-config.js";
import { DEFAULT_CONFIG } from "./config-defaults.js";
import { CONFIG_FORMAT_VERSION } from "./config-types.js";
import type { ConfigIssue, TulisConfig } from "./config-types.js";
import { YamlParseError, parseYaml } from "./parse-yaml.js";
import type { ParsedYaml } from "./parse-yaml.js";

/** Where the team config lives, relative to the repo root. Shown in messages. */
export const CONFIG_FILE = ".tulis/config.yaml";
export const MAX_CONFIG_BYTES = 64 * 1024;

/** O_NONBLOCK does not exist on Windows. */
const optionalConstants: Partial<typeof constants> = constants;

export interface LoadedConfig {
  readonly config: TulisConfig;
  /** "defaults" when there is no config file. */
  readonly source: "file" | "defaults";
  /** Writer-ready lines, each starting with CONFIG_FILE. */
  readonly warnings: readonly string[];
}

/** ".tulis/config.yaml line 4: <message>" or ".tulis/config.yaml: <message>". */
export function formatIssue(issue: ConfigIssue): string {
  return issue.line === undefined
    ? `${CONFIG_FILE}: ${issue.message}`
    : `${CONFIG_FILE} line ${String(issue.line)}: ${issue.message}`;
}

/** The config file could not be used. The CLI maps this to exit code 2. */
export class ConfigError extends Error {
  readonly issues: readonly ConfigIssue[];
  /** Shown after the errors, because a typo warning often explains an error. */
  readonly warnings: readonly ConfigIssue[];

  constructor(
    issues: readonly ConfigIssue[],
    warnings: readonly ConfigIssue[] = [],
  ) {
    super(
      [
        `Could not use ${CONFIG_FILE}.`,
        ...issues.map((issue) => `  ${formatIssue(issue)}`),
        ...warnings.map((warning) => `  ${formatIssue(warning)}`),
      ].join("\n"),
    );
    this.name = "ConfigError";
    this.issues = issues;
    this.warnings = warnings;
  }
}

function fail(message: string, line?: number): ConfigError {
  return new ConfigError([{ key: "", line, message }]);
}

function errorCode(error: unknown): unknown {
  return error instanceof Error && "code" in error ? error.code : undefined;
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return (
    rel !== "" &&
    !isAbsolute(rel) &&
    rel !== ".." &&
    !rel.startsWith(`..${sep}`)
  );
}

/** Reads at most MAX_CONFIG_BYTES + 1 bytes, so the caller can tell "too big". */
async function readCapped(realConfig: string): Promise<Buffer> {
  const handle = await open(
    realConfig,
    constants.O_RDONLY | (optionalConstants.O_NONBLOCK ?? 0),
  );
  try {
    const info = await handle.stat();
    if (!info.isFile()) {
      throw fail("The file is not a regular file.");
    }
    if (info.size > MAX_CONFIG_BYTES) {
      throw fail("The file is larger than 64 KB.");
    }
    const cap = MAX_CONFIG_BYTES + 1;
    const buffer = Buffer.alloc(cap);
    let total = 0;
    while (total < cap) {
      const { bytesRead } = await handle.read(buffer, total, cap - total, null);
      if (bytesRead === 0) {
        break;
      }
      total += bytesRead;
    }
    if (total > MAX_CONFIG_BYTES) {
      throw fail("The file is larger than 64 KB.");
    }
    return buffer.subarray(0, total);
  } finally {
    await handle.close();
  }
}

/** Finds, safely reads, parses and checks `.tulis/config.yaml` in a repo. */
export async function loadConfig(repoRoot: string): Promise<LoadedConfig> {
  let root: string;
  try {
    root = await realpath(repoRoot);
  } catch {
    throw fail("The repository folder could not be opened.");
  }

  let realConfig: string;
  try {
    realConfig = await realpath(join(root, ".tulis", "config.yaml"));
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") {
      return { config: DEFAULT_CONFIG, source: "defaults", warnings: [] };
    }
    throw fail("The file could not be read.");
  }

  if (!isInside(root, realConfig)) {
    throw fail("The file points outside the repository, so it was not read.");
  }

  let bytes: Buffer;
  try {
    bytes = await readCapped(realConfig);
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }
    throw fail("The file could not be read.");
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw fail("The file is not valid UTF-8 text.");
  }

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
