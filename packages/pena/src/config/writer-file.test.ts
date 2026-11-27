import { describe, expect, it } from "vitest";
import { decisionsFileName, isDecisionsFileName } from "./writer-file.js";

describe("decisionsFileName", () => {
  it.each([
    ["Khairul Hafis", "khairul-hafis.yaml"],
    ["José Núñez", "jose-nunez.yaml"],
    ["Strauß", "strauss.yaml"],
    ["Søren Kierkegaard", "soren-kierkegaard.yaml"],
    ["Łukasz", "lukasz.yaml"],
    ["  Ana  ", "ana.yaml"],
    ["o'brien", "o-brien.yaml"],
    ["李明 (Lee)", "lee.yaml"],
    ["../../etc/passwd", "etc-passwd.yaml"],
    ["Æsop Œuvre", "aesop-oeuvre.yaml"],
    ["Þor Đorđe ı", "thor-dorde-i.yaml"],
  ])("turns %j into %s", (name, expected) => {
    expect(decisionsFileName(name)).toBe(expected);
  });

  it("gives writer- plus 8 hex characters for names with no English letters", () => {
    const first = decisionsFileName("李明");
    expect(first).toMatch(/^writer-[0-9a-f]{8}\.yaml$/);
    expect(decisionsFileName("李明")).toBe(first);
    expect(decisionsFileName("王芳")).not.toBe(first);
    expect(decisionsFileName("---")).toMatch(/^writer-[0-9a-f]{8}\.yaml$/);
  });

  it("hashes the NFC form, so composed and decomposed names agree", () => {
    expect(decisionsFileName("é李")).toBe(decisionsFileName("é李"));
  });

  it("adds -writer to Windows reserved names", () => {
    expect(decisionsFileName("con")).toBe("con-writer.yaml");
    expect(decisionsFileName("COM1")).toBe("com1-writer.yaml");
    expect(decisionsFileName("nul.")).toBe("nul-writer.yaml");
    expect(decisionsFileName("LPT9")).toBe("lpt9-writer.yaml");
    expect(decisionsFileName("console")).toBe("console.yaml");
  });

  it("cuts long names to 64 characters without a trailing hyphen", () => {
    const long = decisionsFileName("a".repeat(300));
    expect(long).toBe(`${"a".repeat(64)}.yaml`);

    const hyphenated = decisionsFileName(`${"a".repeat(63)} ${"b".repeat(20)}`);
    expect(hyphenated).toBe(`${"a".repeat(63)}.yaml`);
  });

  it("returns undefined for empty or whitespace names", () => {
    expect(decisionsFileName("")).toBeUndefined();
    expect(decisionsFileName(" \t\n ")).toBeUndefined();
  });

  it("handles NUL and bidi characters", () => {
    expect(decisionsFileName("ana\u0000bo")).toBe("ana-bo.yaml");
    expect(decisionsFileName("ana‮bo")).toBe("ana-bo.yaml");
  });

  it("caps its work on very long input", () => {
    const name = decisionsFileName(`${"x".repeat(1000)}${"y".repeat(100000)}`);
    expect(name).toBe(`${"x".repeat(64)}.yaml`);
  });

  it("only produces names that pass isDecisionsFileName", () => {
    const names = [
      "Khairul Hafis",
      "José Núñez",
      "李明",
      "---",
      "con",
      "nul.",
      "../../etc/passwd",
      "a".repeat(300),
      "ana\u0000bo",
      "ana‮bo",
      "😀 emoji",
    ];
    for (const name of names) {
      const result = decisionsFileName(name);
      expect(result).toBeDefined();
      expect(isDecisionsFileName(result ?? "")).toBe(true);
    }
  });
});

describe("isDecisionsFileName", () => {
  it("accepts good names", () => {
    expect(isDecisionsFileName("a.yaml")).toBe(true);
    expect(isDecisionsFileName("khairul-hafis.yaml")).toBe(true);
    expect(isDecisionsFileName(`${"a".repeat(64)}.yaml`)).toBe(true);
  });

  it.each([
    "a.yml",
    "-a.yaml",
    "a-.yaml",
    "A.yaml",
    "a..yaml",
    ".yaml",
    "a--b.yaml",
    "a b.yaml",
    "a/b.yaml",
    "a.yaml\n",
    `${"a".repeat(65)}.yaml`,
  ])("rejects %j", (name) => {
    expect(isDecisionsFileName(name)).toBe(false);
  });
});
