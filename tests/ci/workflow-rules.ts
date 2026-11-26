// Rules for the CI guard. They check GitHub Actions workflow files line by
// line with simple regexes, because no YAML parser is allowed.

export interface WorkflowFinding {
  line: number; // 1-based
  text: string; // the trimmed line
}

const USES_LINE = /^(?:- +)?uses:(.*)$/;

// owner/repo or owner/repo/sub/path, then @ and a 40 character lowercase hex
// SHA, optionally quoted, optionally followed by spaces and a comment.
const PINNED_VALUE =
  /^(["']?)[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./-]+)?@[0-9a-f]{40}\1(?: +#.*)?$/;

const WRITE_VALUE = /^(?:- +)?[A-Za-z0-9_-]+: +(["']?)write\1(?: +#.*)?$/;
// Catches write-all and one-line maps such as `permissions: { contents: write }`.
const PERMISSIONS_WITH_WRITE = /^(?:- +)?permissions:[^#]*\bwrite/;

const TOP_LEVEL_BLOCK = /^permissions: *(?:#.*)?$/;
const TOP_LEVEL_READ_ALL = /^permissions: +(?:read-all|\{\})(?: +#.*)? *$/;

function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

export function findUnpinnedActions(text: string): WorkflowFinding[] {
  const findings: WorkflowFinding[] = [];
  splitLines(text).forEach((raw, index) => {
    const trimmed = raw.trim();
    const match = USES_LINE.exec(trimmed);
    if (match === null) return;
    const value = (match[1] ?? "").trim();
    if (!PINNED_VALUE.test(value)) {
      findings.push({ line: index + 1, text: trimmed });
    }
  });
  return findings;
}

export function findWritePermissions(text: string): WorkflowFinding[] {
  const findings: WorkflowFinding[] = [];
  splitLines(text).forEach((raw, index) => {
    const trimmed = raw.trim();
    if (WRITE_VALUE.test(trimmed) || PERMISSIONS_WITH_WRITE.test(trimmed)) {
      findings.push({ line: index + 1, text: trimmed });
    }
  });
  return findings;
}

export function hasTopLevelReadPermissions(text: string): boolean {
  return splitLines(text).some(
    (line) => TOP_LEVEL_BLOCK.test(line) || TOP_LEVEL_READ_ALL.test(line),
  );
}
