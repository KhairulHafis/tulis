import { describe, expect, it } from "vitest";
import { checkBranchName, isObjectId, isValidBranchName } from "./ref-name.js";

describe("isValidBranchName", () => {
  it.each([
    "main",
    "master",
    "release/2.0",
    "feature/x-y_z",
    "v1.2.3",
    "a",
    "a".repeat(255),
  ])("accepts %s", (name) => {
    expect(isValidBranchName(name)).toBe(true);
  });

  it.each([
    "",
    "-x",
    "--output=x.md",
    "@",
    "HEAD",
    "a b",
    "a~1",
    "a^",
    "a:b",
    "a?",
    "a*",
    "a[b",
    "a\\b",
    "a..b",
    "a@{1}",
    "/a",
    "a/",
    "a//b",
    "a.",
    ".a",
    "a/.b",
    "a.lock",
    "a/b.lock/c",
    "a\u0000b",
    "a\u001fb",
    "a\u007fb",
    "a".repeat(256),
  ])("rejects %j", (name) => {
    expect(isValidBranchName(name)).toBe(false);
  });
});

describe("checkBranchName", () => {
  it("does not throw for a valid name", () => {
    expect(() => {
      checkBranchName("main");
    }).not.toThrow();
  });

  it("throws and shows the name as safe text", () => {
    expect(() => {
      checkBranchName("\u001b[31m");
    }).toThrow('Invalid branch name "?[31m"');
  });
});

describe("isObjectId", () => {
  it("accepts 40 and 64 lower-case hex characters", () => {
    expect(isObjectId("a".repeat(40))).toBe(true);
    expect(isObjectId("0123456789abcdef".repeat(4))).toBe(true);
  });

  it("rejects wrong lengths", () => {
    for (const n of [39, 41, 63, 65]) {
      expect(isObjectId("a".repeat(n))).toBe(false);
    }
  });

  it("rejects upper case, non-hex and trailing newline", () => {
    expect(isObjectId("A".repeat(40))).toBe(false);
    expect(isObjectId(`${"a".repeat(39)}g`)).toBe(false);
    expect(isObjectId(`${"a".repeat(40)}\n`)).toBe(false);
  });
});
