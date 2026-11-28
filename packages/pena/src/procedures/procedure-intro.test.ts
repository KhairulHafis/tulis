import { describe, expect, it } from "vitest";
import { prepareDoc, type PreparedBlock } from "../prepare/prepare-doc.js";
import { procedureIntro } from "./procedure-intro.js";

function blockOf(text: string): PreparedBlock {
  const doc = prepareDoc(text + "\n", "markdown");
  const block = doc.kind === "prepared" ? doc.blocks[0] : undefined;
  if (block === undefined) {
    throw new Error("no block");
  }
  return block;
}

describe("procedureIntro", () => {
  it("finds a colon", () => {
    expect(procedureIntro(blockOf("To install the agent:"))).toBe("colon");
    expect(procedureIntro(blockOf("Follow these steps:"))).toBe("colon");
  });
  it("finds a heading", () => {
    expect(procedureIntro(blockOf("## Install"))).toBe("heading");
  });
  it("ignores a paragraph that ends in a period", () => {
    expect(procedureIntro(blockOf("Install the agent."))).toBeUndefined();
  });
  it("ignores a table cell", () => {
    const doc = prepareDoc("| a: |\n| - |\n| b |\n", "markdown");
    const cell = doc.kind === "prepared" ? doc.blocks[0] : undefined;
    expect(cell?.kind).toBe("tableCell");
    expect(procedureIntro(cell)).toBeUndefined();
  });
  it("gives undefined for no block", () => {
    expect(procedureIntro(undefined)).toBeUndefined();
  });
});
