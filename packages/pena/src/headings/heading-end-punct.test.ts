import { describe, expect, it } from "vitest";
import type { Token } from "../language/tokens.js";
import { prepareDoc } from "../prepare/prepare-doc.js";
import { headingEndPunct, type HeadingEndPunct } from "./heading-end-punct.js";

function tokensOf(heading: string): readonly Token[] {
  const result = prepareDoc("## " + heading + "\n", "markdown");
  if (result.kind !== "prepared") throw new Error("not prepared");
  const sentence = result.blocks[0]?.sentences[0];
  if (sentence === undefined) throw new Error("no sentence");
  return sentence.tokens;
}

const ACCEPTANCE: readonly (readonly [string, HeadingEndPunct | undefined])[] =
  [
    ["Install the agent", "none"],
    ["Install the agent.", "period"],
    ["Prerequisites:", "colon"],
    ["Use `foo`:", "colon"],
    ["Step 1.", "period"],
    ["What is a Pod?", undefined],
    ["Wow!", undefined],
    ["And more...", undefined],
    ["And more…", undefined],
    ["Install it;", undefined],
    ["Setup (optional)", "none"],
    ["Run `make`", "none"],
    ["`kubectl`", "none"],
  ];

describe("headingEndPunct", () => {
  for (const [heading, expected] of ACCEPTANCE) {
    it(heading + " -> " + String(expected), () => {
      expect(headingEndPunct(tokensOf(heading))).toBe(expected);
    });
  }

  it("returns undefined for no tokens", () => {
    expect(headingEndPunct([])).toBeUndefined();
  });

  it("returns undefined for a trailing comma", () => {
    expect(headingEndPunct(tokensOf("Install it,"))).toBeUndefined();
  });

  it("treats two dots that do not touch as a period", () => {
    expect(headingEndPunct(tokensOf("And more. ."))).toBe("period");
  });

  it("counts a closing quote as none", () => {
    expect(headingEndPunct(tokensOf('Say "hi"'))).toBe("none");
  });
});
