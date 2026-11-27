import { readFile } from "node:fs/promises";
import { checkVariants } from "../config/check-variants.js";
import { MAX_VARIANTS_BYTES } from "../config/load-variants.js";
import { YamlParseError, parseYaml } from "../config/parse-yaml.js";
import { formatKey } from "../config/issue-collector.js";
import { VARIANTS_FORMAT_VERSION } from "../config/variants-types.js";
import type { VariantGroup } from "../config/variants-types.js";

const PREFIX = "The built-in seed list is invalid: ";

export class SeedListError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SeedListError";
  }
}

interface Problem {
  readonly key: string;
  readonly line: number | undefined;
  readonly message: string;
}

function describe(problem: Problem): string {
  const where = problem.key === "" ? "" : `${problem.key}: `;
  const line =
    problem.line === undefined ? "" : `line ${String(problem.line)}: `;
  return `${where}${line}${problem.message}`;
}

function fail(problems: readonly Problem[], cause?: unknown): never {
  const [first] = problems;
  if (first === undefined) {
    throw new SeedListError(`${PREFIX}unknown problem.`);
  }
  const more =
    problems.length > 1 ? ` (and ${String(problems.length - 1)} more)` : "";
  throw new SeedListError(
    `${PREFIX}${describe(first)}${more}`,
    cause === undefined ? undefined : { cause },
  );
}

/** Parses and checks seed list text. Throws SeedListError on any problem. Returns frozen groups, each with source "seed", in file order. */
export function parseSeedGroups(text: string): readonly VariantGroup[] {
  let parsed;
  try {
    parsed = parseYaml(text, { maxBytes: MAX_VARIANTS_BYTES });
  } catch (error) {
    if (error instanceof YamlParseError) {
      fail(
        [
          {
            key: "",
            line: error.line,
            message: `Not valid YAML: ${error.reason}`,
          },
        ],
        error,
      );
    }
    throw error;
  }

  const check = checkVariants(parsed.value, parsed.lineOf);
  const problems: Problem[] = [...check.errors, ...check.warnings];

  if (check.fileVersion === undefined) {
    problems.push({
      key: "version",
      line: undefined,
      message: "The seed list needs a version.",
    });
  } else if (check.fileVersion !== VARIANTS_FORMAT_VERSION) {
    problems.push({
      key: "version",
      line: parsed.lineOf(["version"]),
      message: `The seed list must use version ${String(VARIANTS_FORMAT_VERSION)}.`,
    });
  }
  if (check.variants.rejected.length > 0) {
    problems.push({
      key: "rejected",
      line: parsed.lineOf(["rejected"]),
      message: "The seed list can't have rejected entries.",
    });
  }
  if (check.variants.disabled.length > 0) {
    problems.push({
      key: "groups",
      line: parsed.lineOf(["groups"]),
      message: "The seed list can't have disabled entries.",
    });
  }
  check.variants.groups.forEach((group, index) => {
    if (group.source !== "team") {
      const path = ["groups", index];
      problems.push({
        key: formatKey(path),
        line: parsed.lineOf(path),
        message: "Seed groups can't have a source.",
      });
    }
  });

  if (problems.length > 0) {
    fail(problems);
  }
  return Object.freeze(
    check.variants.groups.map((group): VariantGroup => {
      return Object.freeze({ ...group, source: "seed" });
    }),
  );
}

/** Reads packages/pena/seeds/variants.yaml and calls parseSeedGroups. */
export async function loadSeedGroups(): Promise<readonly VariantGroup[]> {
  const text = await readFile(
    new URL("../../seeds/variants.yaml", import.meta.url),
    "utf8",
  );
  return parseSeedGroups(text);
}
