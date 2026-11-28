import { describe, expect, it } from "vitest";
import { prepareDoc } from "../prepare/prepare-doc.js";
import { sectionName } from "./section-name.js";

function names(text: string): (string | undefined)[] {
  const doc = prepareDoc(text, "markdown");
  if (doc.kind !== "prepared") {
    throw new Error("skipped");
  }
  return doc.blocks
    .filter((b) => b.node.type === "heading")
    .map((b) => sectionName(b, doc.parsed.source));
}

describe("sectionName", () => {
  it("normalises case, spaces and one trailing colon", () => {
    expect(names("## Before   You Begin :\n")).toEqual(["before you begin"]);
  });

  it("reads a Hugo heading tag argument", () => {
    expect(names('## {{< heading "whatsnext" >}}\n')).toEqual(["whatsnext"]);
    expect(names('## {{%heading  "a b"%}}\n')).toEqual(["a b"]);
  });

  it("falls back to masked text when the tag argument is too long", () => {
    const long = "x".repeat(101);
    expect(names(`## {{< heading "${long}" >}}\n`)).toEqual([undefined]);
  });

  it("does not take a mismatched tag as a heading tag", () => {
    expect(names('## {{< heading "a" %}}\n')).toEqual([undefined]);
  });

  it("returns undefined for a code-only heading", () => {
    expect(names("## `x`\n")).toEqual([undefined]);
  });
});
