import { describe, expect, it } from "vitest";
import { prepareDoc } from "../prepare/prepare-doc.js";
import { findUiLabels, UI_LABEL_VERBS } from "./ui-label-format.js";

/** Labels of the first sentence of the first block, as [format, slice]. */
function labels(text: string): readonly (readonly [string, string])[] {
  const doc = prepareDoc(text, "markdown");
  if (doc.kind !== "prepared") {
    throw new Error("expected a prepared doc");
  }
  const sentence = doc.blocks[0]?.sentences[0];
  if (sentence === undefined) {
    throw new Error("no sentence");
  }
  const source = doc.parsed.source;
  return findUiLabels(sentence.tokens, source).map((l) => [
    l.format,
    source.slice(l.start, l.end),
  ]);
}

describe("findUiLabels verbs", () => {
  it("knows exactly the listed verbs", () => {
    expect([...UI_LABEL_VERBS].sort()).toEqual(
      [
        "choose",
        "clear",
        "click",
        "double-click",
        "expand",
        "right-click",
        "select",
        "tap",
      ].sort(),
    );
  });

  for (const verb of [
    "click",
    "double-click",
    "right-click",
    "select",
    "choose",
    "tap",
    "expand",
    "clear",
  ]) {
    it(`records bold after "${verb}" in any case and position`, () => {
      expect(labels(`${verb} **Save**.`)).toEqual([
        ["bold", `${verb} **Save**`],
      ]);
      const upper = verb.toUpperCase();
      expect(labels(`First ${upper} **Save**.`)).toEqual([
        ["bold", `${upper} **Save**`],
      ]);
    });
  }

  for (const verb of ["check", "open", "press"]) {
    it(`records nothing after "${verb}"`, () => {
      expect(labels(`${verb} **Save**.`)).toEqual([]);
      expect(labels(`${verb} "Save".`)).toEqual([]);
    });
  }
});

describe("findUiLabels skipped words", () => {
  it("skips the and on, in any case", () => {
    expect(labels("Click on **Save**.")).toEqual([
      ["bold", "Click on **Save**"],
    ]);
    expect(labels("Click the **Save**.")).toEqual([
      ["bold", "Click the **Save**"],
    ]);
    expect(labels("Click ON THE **Save**.")).toEqual([
      ["bold", "Click ON THE **Save**"],
    ]);
    expect(labels("Click the `Save`.")).toEqual([["code", "Click the `Save`"]]);
    expect(labels('Click the "Save".')).toEqual([
      ["quotes", 'Click the "Save"'],
    ]);
  });

  it("skips at most two words", () => {
    expect(labels("Click on the **Save**.")).toHaveLength(1);
    expect(labels("Click the the **Save**.")).toHaveLength(1);
    expect(labels("Click on the the **Save**.")).toEqual([]);
    expect(labels("Click on on on **Save**.")).toEqual([]);
  });

  it("does not skip for plain labels", () => {
    expect(labels("Click on Save.")).toEqual([]);
  });

  it("skips only the and on", () => {
    expect(labels("Click a **Save**.")).toEqual([]);
    expect(labels("Click in **Save**.")).toEqual([]);
  });
});

describe("findUiLabels formats", () => {
  it("applies the uppercase rule to code and bold", () => {
    expect(labels("Select `Save`.")).toHaveLength(1);
    expect(labels("Select `save`.")).toEqual([]);
    expect(labels("Select **1. Save**.")).toHaveLength(1);
    expect(labels("Select **1. save**.")).toEqual([]);
    expect(labels("Select **123**.")).toEqual([]);
  });

  it("reads the first letter only in the first 200 characters", () => {
    const early = "a".repeat(10);
    const late = "1".repeat(250) + " Save";
    expect(late.indexOf("Save")).toBeGreaterThan(200);
    expect(labels(`Select **${late}**.`)).toEqual([]);
    expect(labels(`Select **${early} Save**.`)).toEqual([]);
    const within = "1".repeat(150) + " Save";
    expect(labels(`Select **${within}**.`)).toHaveLength(1);
    expect(labels(`Select \`${late}\`.`)).toEqual([]);
    expect(labels(`Select \`${within}\`.`)).toHaveLength(1);
  });

  it("accepts a hugo ui shortcode with percent delimiters and tabs", () => {
    expect(labels('Select {{% ui text="A" %}}.')).toHaveLength(1);
    expect(labels('Select {{<ui text="A" >}}.')).toHaveLength(1);
    expect(labels('Select {{<\tui\ttext="A" >}}.')).toHaveLength(1);
    expect(labels('Select {{< uix text="A" >}}.')).toEqual([]);
    expect(labels("Select {{< ui >}}.")).toHaveLength(1);
  });

  it("records plain only when all conditions hold", () => {
    expect(labels("Select Settings.")).toEqual([["plain", "Select Settings"]]);
    expect(labels("Select Settings")).toEqual([]);
    expect(labels("Select Settings!")).toEqual([]);
    expect(labels("Select settings.")).toEqual([]);
    expect(labels("Select 5.")).toEqual([]);
    expect(labels("Then select Settings.")).toEqual([]);
    expect(labels("Then, select Settings.")).toEqual([
      ["plain", "select Settings"],
    ]);
    // The sentence end is at most 8 tokens after the verb.
    expect(labels("Select A b c d e f g.")).toHaveLength(1);
    expect(labels("Select A b c d e f g h.")).toEqual([]);
  });

  it("needs only whitespace between a plain verb and its label", () => {
    expect(labels("Select [Settings](x).")).toEqual([]);
  });

  it("records quotes only with a close within 12 tokens", () => {
    const words = (n: number): string =>
      Array.from({ length: n }, (_, i) => (i === 0 ? "Save" : "x")).join(" ");
    expect(labels(`Select "${words(11)}" now.`)).toHaveLength(1);
    expect(labels(`Select "${words(12)}" now.`)).toEqual([]);
    expect(labels("Select ‘Save’ now.")).toHaveLength(1);
    expect(labels("Select “Save” now.")).toHaveLength(1);
    expect(labels("Select “Save’ now.")).toEqual([]);
  });
});
