import { describe, expect, it } from "vitest";
import { prepareDoc } from "../prepare/prepare-doc.js";
import { stepEndPunct } from "./step-end-punct.js";

function endOf(text: string): ReturnType<typeof stepEndPunct> {
  const doc = prepareDoc(text + "\n", "markdown");
  if (doc.kind !== "prepared") {
    throw new Error("not prepared");
  }
  const sentences = doc.blocks[0]?.sentences ?? [];
  const last = sentences[sentences.length - 1];
  if (last === undefined) {
    throw new Error("no sentence");
  }
  return stepEndPunct(last.tokens);
}

describe("stepEndPunct", () => {
  it.each([
    ["Select **Save**.", "period"],
    ["Select **Save**", "none"],
    ["Run `make`", "none"],
    ["Run:", undefined],
    ["Is it ready?", undefined],
    ["Wait...", undefined],
    ["(See the guide.)", "period"],
    ["Select **Save** (optional)", "none"],
    ['Use "quoted"', "none"],
  ])("%s", (text, expected) => {
    expect(endOf(text)).toBe(expected);
  });

  it("ignores a closing curly quote", () => {
    const quote = String.fromCodePoint(0x201d);
    expect(endOf("Use " + quote + "x" + quote)).toBe("none");
  });

  it("gives undefined for no tokens", () => {
    expect(stepEndPunct([])).toBeUndefined();
  });
});
