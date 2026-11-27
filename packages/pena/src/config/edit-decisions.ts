import { Pair, Scalar, YAMLMap, isMap, isScalar } from "yaml";
import type { YAMLSeq } from "yaml";
import { checkDecisions } from "./check-decisions.js";
import {
  DECISIONS_FOLDER,
  DECISIONS_FORMAT_VERSION,
} from "./decisions-types.js";
import { MAX_DECISIONS_BYTES, readDecisionsFile } from "./load-decisions.js";
import type { DecisionsFile } from "./load-decisions.js";
import {
  UNSAFE_REASON,
  documentToEdit,
  refused,
  topLevelList,
  writeEditedDocument,
} from "./edit-team-file.js";
import type { TeamFileEditOutcome } from "./edit-team-file.js";
import type { ParsedYamlDocument } from "./parse-yaml.js";
import { isDecisionsFileName } from "./writer-file.js";

/** What a file looks like when Tulis creates it. */
const NEW_FILE_TEXT = `# Flags this writer dismissed. Tulis adds these up across writers.
version: ${String(DECISIONS_FORMAT_VERSION)}
`;

const MAX_COUNT = 1_000_000;

function indexOfCheck(list: YAMLSeq, check: string): number {
  return list.items.findIndex(
    (item) => isMap(item) && item.get("check") === check,
  );
}

function newEntry(check: string, day: string): YAMLMap {
  const last = new Scalar(day);
  last.type = Scalar.QUOTE_DOUBLE;
  const map = new YAMLMap();
  map.add(new Pair(new Scalar("check"), new Scalar(check)));
  map.add(new Pair(new Scalar("count"), new Scalar(1)));
  map.add(new Pair(new Scalar("last"), last));
  return map;
}

/** Bumps the count and moves `last` forward. false when the entry is not shaped as expected. */
function updateEntry(
  parsed: ParsedYamlDocument,
  index: number,
  day: string,
): boolean {
  const doc = parsed.document;
  const count: unknown = doc.getIn(["dismissals", index, "count"]);
  const last = doc.getIn(["dismissals", index, "last"], true);
  if (typeof count !== "number" || !isScalar(last)) {
    return false;
  }
  if (count < MAX_COUNT) {
    doc.setIn(["dismissals", index, "count"], count + 1);
  }
  if (typeof last.value === "string" && day > last.value) {
    // Setting the value on the existing node keeps its quoting style.
    last.value = day;
  }
  return true;
}

/**
 * Records one dismissal of `check` in `.tulis/decisions/<fileName>`.
 * `day` is the writer's local date as "YYYY-MM-DD" (the caller supplies it, so tests are stable).
 * Never returns "already-present".
 */
export async function recordDismissal(
  repoRoot: string,
  fileName: string,
  check: string,
  day: string,
): Promise<TeamFileEditOutcome> {
  if (!isDecisionsFileName(fileName)) {
    throw new TypeError("fileName is not a decisions file name");
  }
  const checked = checkDecisions({
    version: DECISIONS_FORMAT_VERSION,
    dismissals: [{ check, count: 1, last: day }],
  });
  const first = checked.errors[0];
  if (first !== undefined) {
    throw new TypeError(first.message);
  }

  const file: DecisionsFile = await readDecisionsFile(repoRoot, fileName);
  if (file.writeBlocked !== undefined) {
    return refused(file.writeBlocked);
  }

  const parsed = documentToEdit(file, NEW_FILE_TEXT, MAX_DECISIONS_BYTES);
  if (parsed === undefined) {
    return refused(UNSAFE_REASON);
  }

  const list = topLevelList(parsed, "dismissals");
  if (list === undefined) {
    return refused(UNSAFE_REASON);
  }
  const index = indexOfCheck(list, check);
  if (index === -1) {
    list.add(newEntry(check, day));
  } else if (!updateEntry(parsed, index, day)) {
    return refused(UNSAFE_REASON);
  }

  return writeEditedDocument(repoRoot, [DECISIONS_FOLDER, fileName], parsed, {
    maxBytes: MAX_DECISIONS_BYTES,
    expected: file.text,
  });
}
