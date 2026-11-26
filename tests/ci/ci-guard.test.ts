import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  findUnpinnedActions,
  findWritePermissions,
  hasTopLevelReadPermissions,
  type WorkflowFinding,
} from "./workflow-rules.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const workflowDir = ".github/workflows";

// Regular files only: symlinks are skipped, never followed.
function listWorkflowFiles(): string[] {
  return readdirSync(join(repoRoot, workflowDir), { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml")),
    )
    .map((entry) => entry.name)
    .sort();
}

const files = listWorkflowFiles();

function readWorkflow(name: string): string {
  return readFileSync(join(repoRoot, workflowDir, name), "utf8");
}

function collect(
  rule: (text: string) => WorkflowFinding[],
  label: string,
): string[] {
  const problems: string[] = [];
  for (const name of files) {
    for (const finding of rule(readWorkflow(name))) {
      problems.push(
        `${workflowDir}/${name}:${String(finding.line)} ${label}: ${finding.text}`,
      );
    }
  }
  return problems;
}

describe("CI guard", () => {
  it("finds the workflow files", () => {
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain("ci.yml");
  });

  it("pins every action to a commit SHA", () => {
    expect(collect(findUnpinnedActions, "unpinned action")).toEqual([]);
  });

  it("grants no write permissions", () => {
    expect(collect(findWritePermissions, "write permission")).toEqual([]);
  });

  it("sets read-only permissions at the top level", () => {
    const missing = files
      .filter((name) => !hasTopLevelReadPermissions(readWorkflow(name)))
      .map((name) => `${workflowDir}/${name} has no top-level permissions`);
    expect(missing).toEqual([]);
  });
});
