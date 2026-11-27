import { describe, expect, it } from "vitest";
import { expectLinearTime } from "@tulis/testkit";
import { prepareDoc, type PreparedDoc } from "./prepare-doc.js";

function prepared(text: string): PreparedDoc {
  const result = prepareDoc(text, "markdown");
  if (result.kind !== "prepared") {
    throw new Error("expected a prepared doc, got " + result.reason);
  }
  return result;
}

describe("failures", () => {
  it("turns a parser exception into a preparation-error skip", () => {
    const result = prepareDoc("Git Hub <b>**\n---\n", "mdx");
    expect(result).toEqual({
      kind: "skipped",
      syntax: "mdx",
      reason: "preparation-error",
      message: undefined,
      line: undefined,
      column: undefined,
    });
  });

  it("skips a too-deep doc with the parser's message", () => {
    const result = prepareDoc("> ".repeat(200) + "text\n", "markdown");
    expect(result).toMatchObject({ kind: "skipped", reason: "too-deep" });
  });
});

describe("ignore comments", () => {
  it("leaves no blocks when one comment covers everything", () => {
    const doc = prepared(
      "<!-- tulis-ignore-start -->\n\nOne.\n\n# Two\n\n| a |\n| - |\n| b |\n\n<!-- tulis-ignore-end -->\n",
    );
    expect(doc.blocks).toEqual([]);
  });
});

describe("warnings", () => {
  it("carry no doc text", () => {
    const secret = "SECRET-PHRASE";
    const doc = prepared(
      "---\ntitle: " +
        secret +
        "\ntitle: again\n---\n\n<!-- tulis-ignore-end -->\n\n<!-- tulis-ignore " +
        secret +
        " -->\n\n<!-- tulis-ignore-start " +
        secret +
        " -->\n\nText " +
        secret +
        ".\n",
    );
    expect(doc.warnings.length).toBeGreaterThan(1);
    for (const warning of doc.warnings) {
      expect(Object.keys(warning).sort()).toEqual(
        warning.from === "ignore"
          ? ["code", "column", "from", "line"]
          : ["code", "from", "line"],
      );
      expect(JSON.stringify(warning)).not.toContain(secret);
    }
  });
});

describe("timing", () => {
  it("stays linear for many short paragraphs", () => {
    expectLinearTime({
      prepare: (size) => {
        const text = "A short one.\n\n".repeat(size);
        return () => prepareDoc(text, "markdown");
      },
      probe: { size: 250, limitMs: 100 },
      sizes: [500, 1000, 2000],
      smallLimitMs: 200,
      largeLimitMs: 400,
      slack: 4,
      floorMs: 50,
    });
  });

  // A guard, not a proof: a plain scan of all ranges per sentence is only
  // about a million steps at this size, too fast for a sub-second test to catch.
  it("stays linear with an ignore comment before every other paragraph", () => {
    expectLinearTime({
      prepare: (size) => {
        const text = "<!-- tulis-ignore -->\nDrop one.\n\nKeep one.\n\n".repeat(
          size,
        );
        return () => prepareDoc(text, "markdown");
      },
      probe: { size: 125, limitMs: 100 },
      sizes: [125, 250, 1000],
      smallLimitMs: 200,
      largeLimitMs: 400,
      slack: 4,
      floorMs: 50,
    });
  });
});
