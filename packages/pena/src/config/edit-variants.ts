import { Pair, Scalar, YAMLMap, YAMLSeq, isMap } from "yaml";
import { checkVariants, rejectedKey } from "./check-variants.js";
import type { VariantsCheckResult } from "./check-variants.js";
import { MAX_VARIANTS_BYTES, readVariantsFile } from "./load-variants.js";
import type { VariantsFile } from "./load-variants.js";
import {
  UNSAFE_REASON,
  documentToEdit,
  refused,
  topLevelList,
  writeEditedDocument,
} from "./edit-team-file.js";
import type { TeamFileEditOutcome } from "./edit-team-file.js";
import type { ParsedYamlDocument } from "./parse-yaml.js";
import { TeamFileUseError } from "./team-issue.js";
import { VARIANTS_FORMAT_VERSION } from "./variants-types.js";

export type ConfirmedGroup =
  | {
      readonly id: string;
      readonly kind: "synonym";
      readonly variants: readonly string[];
    }
  | {
      readonly id: string;
      readonly kind: "verb-noun";
      readonly noun: string;
      readonly verb: string;
    };

/** What a file looks like when Tulis creates it. */
const NEW_FILE_TEXT = `# Team word groups for Tulis.
# A group with the same id as a built-in group replaces it.
# An entry with only an id and \`enabled: false\` switches a group off.
version: ${String(VARIANTS_FORMAT_VERSION)}
`;

type EditResult = "added" | "already-present" | "unsafe";

function wordScalar(word: string): Scalar {
  const scalar = new Scalar(word);
  scalar.type = Scalar.QUOTE_DOUBLE;
  return scalar;
}

function wordList(words: readonly string[]): YAMLSeq {
  const seq = new YAMLSeq();
  seq.flow = true;
  for (const word of words) {
    seq.add(wordScalar(word));
  }
  return seq;
}

function entryMap(pairs: readonly (readonly [string, unknown])[]): YAMLMap {
  const map = new YAMLMap();
  for (const [key, value] of pairs) {
    map.add(new Pair(new Scalar(key), value));
  }
  return map;
}

/** The first problem as a TypeError, for input that is not a valid entry. */
function requireValid(check: VariantsCheckResult): void {
  const first = check.errors[0];
  if (first !== undefined) {
    throw new TypeError(first.message);
  }
}

function hasGroupId(list: YAMLSeq, id: string): boolean {
  return list.items.some((item) => isMap(item) && item.get("id") === id);
}

async function editVariantsFile(
  repoRoot: string,
  edit: (parsed: ParsedYamlDocument, check: VariantsCheckResult) => EditResult,
): Promise<TeamFileEditOutcome> {
  let file: VariantsFile;
  try {
    file = await readVariantsFile(repoRoot);
  } catch (error) {
    if (error instanceof TeamFileUseError) {
      return refused(error.issues[0]?.message ?? UNSAFE_REASON);
    }
    throw error;
  }
  if (file.writeBlocked !== undefined) {
    return refused(file.writeBlocked);
  }

  const parsed = documentToEdit(file, NEW_FILE_TEXT, MAX_VARIANTS_BYTES);
  if (parsed === undefined) {
    return refused(UNSAFE_REASON);
  }

  const result = edit(parsed, file.check);
  if (result === "already-present") {
    return { status: "already-present" };
  }
  if (result === "unsafe") {
    return refused(UNSAFE_REASON);
  }
  return writeEditedDocument(repoRoot, ["variants.yaml"], parsed, {
    maxBytes: MAX_VARIANTS_BYTES,
    expected: file.text,
  });
}

/** Adds a confirmed group with `source: discovered` at the end of `groups`. "already-present" when any entry in `groups` (enabled or not) has the same id. */
export async function addConfirmedGroup(
  repoRoot: string,
  group: ConfirmedGroup,
): Promise<TeamFileEditOutcome> {
  const candidate =
    group.kind === "synonym"
      ? {
          id: group.id,
          kind: group.kind,
          variants: [...group.variants],
          source: "discovered",
        }
      : {
          id: group.id,
          kind: group.kind,
          noun: group.noun,
          verb: group.verb,
          source: "discovered",
        };
  const checked = checkVariants({
    version: VARIANTS_FORMAT_VERSION,
    groups: [candidate],
  });
  requireValid(checked);
  const valid = checked.variants.groups[0];
  if (valid === undefined) {
    throw new TypeError("The group is not valid.");
  }

  return editVariantsFile(repoRoot, (parsed) => {
    const list = topLevelList(parsed, "groups");
    if (list === undefined) {
      return "unsafe";
    }
    if (hasGroupId(list, valid.id)) {
      return "already-present";
    }
    const pairs: (readonly [string, unknown])[] = [
      ["id", new Scalar(valid.id)],
      ["kind", new Scalar(valid.kind)],
    ];
    if (valid.kind === "synonym") {
      pairs.push(["variants", wordList(valid.variants)]);
    } else {
      pairs.push(["noun", wordScalar(valid.noun)]);
      pairs.push(["verb", wordScalar(valid.verb)]);
    }
    pairs.push(["source", new Scalar("discovered")]);
    list.add(entryMap(pairs));
    return "added";
  });
}

/** Adds `{ variants: [...] }` at the end of `rejected`. "already-present" when a rejected entry has the same rejectedKey. */
export async function addRejectedGroup(
  repoRoot: string,
  words: readonly string[],
): Promise<TeamFileEditOutcome> {
  const checked = checkVariants({
    version: VARIANTS_FORMAT_VERSION,
    rejected: [{ variants: [...words] }],
  });
  requireValid(checked);
  const valid = checked.variants.rejected[0];
  if (valid === undefined) {
    throw new TypeError("The words are not valid.");
  }
  const key = rejectedKey(valid.variants);

  return editVariantsFile(repoRoot, (parsed, check) => {
    if (check.variants.rejected.some((r) => rejectedKey(r.variants) === key)) {
      return "already-present";
    }
    const list = topLevelList(parsed, "rejected");
    if (list === undefined) {
      return "unsafe";
    }
    list.add(entryMap([["variants", wordList(valid.variants)]]));
    return "added";
  });
}
