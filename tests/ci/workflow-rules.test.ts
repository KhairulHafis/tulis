import { describe, expect, it } from "vitest";
import {
  findUnpinnedActions,
  findWritePermissions,
  hasTopLevelReadPermissions,
} from "./workflow-rules.js";

const SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";

describe("findUnpinnedActions", () => {
  it("accepts pinned actions", () => {
    const text = [
      `uses: actions/checkout@${SHA} # v7.0.1`,
      `  - uses: github/codeql-action/init@${SHA}`,
      `uses: "actions/checkout@${SHA}"`,
      `uses: 'actions/checkout@${SHA}' # v7`,
      `- uses: actions/checkout@${SHA}`,
    ].join("\n");
    expect(findUnpinnedActions(text)).toEqual([]);
  });

  const bad: [string, string][] = [
    ["a tag", "uses: actions/checkout@v7"],
    ["a branch", "uses: actions/checkout@main"],
    ["a short SHA", "uses: actions/checkout@3d3c42e"],
    ["uppercase hex", `uses: actions/checkout@${SHA.toUpperCase()}`],
    ["non-hex characters", `uses: actions/checkout@${"g".repeat(40)}`],
    ["a 41 character SHA", `uses: actions/checkout@${SHA}0`],
    ["no @", "uses: actions/checkout"],
    ["a local action", "uses: ./local-action"],
    ["a docker image", "uses: docker://alpine:3"],
    ["a mismatched quote", `uses: "actions/checkout@${SHA}`],
  ];
  for (const [name, line] of bad) {
    it(`flags ${name} with its line number`, () => {
      const text = `a: 1\nsteps:\n  - ${line}\n`;
      expect(findUnpinnedActions(text)).toEqual([
        { line: 3, text: `- ${line}` },
      ]);
    });
  }

  it("ignores comments and mid-text mentions", () => {
    const text = [
      "# uses: foo@v1",
      "  # uses: foo@v1",
      "run: echo uses: foo@v1",
      "name: uses: foo@v1",
    ].join("\n");
    expect(findUnpinnedActions(text)).toEqual([]);
  });

  it("gives the same results for CRLF input", () => {
    const lf = `a: 1\nuses: actions/checkout@v7\nuses: x/y@${SHA}\n`;
    const crlf = lf.replace(/\n/g, "\r\n");
    expect(findUnpinnedActions(crlf)).toEqual(findUnpinnedActions(lf));
    expect(findUnpinnedActions(crlf)).toEqual([
      { line: 2, text: "uses: actions/checkout@v7" },
    ]);
  });
});

describe("findWritePermissions", () => {
  const bad = [
    "contents: write",
    "id-token: write",
    "permissions: write-all",
    'contents: "write"',
    "contents: 'write'",
    "contents: write # needed for release",
    "permissions: { contents: write }",
    "permissions: {contents: read, issues: write}",
  ];
  for (const line of bad) {
    it(`flags ${line}`, () => {
      const text = `permissions:\n  ${line}\n`;
      expect(findWritePermissions(text)).toEqual([{ line: 2, text: line }]);
    });
  }

  it("allows read, none and read-all", () => {
    const text = [
      "contents: read",
      "packages: none",
      "permissions: read-all",
      "permissions: { contents: read } # not write",
      "# contents: write",
    ].join("\n");
    expect(findWritePermissions(text)).toEqual([]);
  });

  it("gives the same results for CRLF input", () => {
    const lf = "permissions:\n  contents: write\n  issues: read\n";
    const crlf = lf.replace(/\n/g, "\r\n");
    expect(findWritePermissions(crlf)).toEqual(findWritePermissions(lf));
    expect(findWritePermissions(crlf)).toEqual([
      { line: 2, text: "contents: write" },
    ]);
  });
});

describe("hasTopLevelReadPermissions", () => {
  it("is true for a top-level permissions block", () => {
    expect(
      hasTopLevelReadPermissions("name: CI\npermissions:\n  contents: read\n"),
    ).toBe(true);
  });

  it("is true for a block with a trailing comment or spaces", () => {
    expect(hasTopLevelReadPermissions("permissions: # read only\n")).toBe(true);
    expect(hasTopLevelReadPermissions("permissions:   \n")).toBe(true);
  });

  it("is true for read-all and an empty map", () => {
    expect(hasTopLevelReadPermissions("permissions: read-all\n")).toBe(true);
    expect(hasTopLevelReadPermissions("permissions: {}\n")).toBe(true);
  });

  it("is false when permissions is only indented under a job", () => {
    const text = "jobs:\n  a:\n    permissions:\n      contents: read\n";
    expect(hasTopLevelReadPermissions(text)).toBe(false);
  });

  it("is false when absent or write-all", () => {
    expect(hasTopLevelReadPermissions("name: CI\n")).toBe(false);
    expect(hasTopLevelReadPermissions("permissions: write-all\n")).toBe(false);
  });

  it("gives the same result for CRLF input", () => {
    expect(
      hasTopLevelReadPermissions("permissions:\r\n  contents: read\r\n"),
    ).toBe(true);
    expect(hasTopLevelReadPermissions("permissions: read-all\r\n")).toBe(true);
  });
});
