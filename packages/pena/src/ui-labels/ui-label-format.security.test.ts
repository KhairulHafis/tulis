import { describe, expect, it } from "vitest";
import { expectLinearTime } from "@tulis/testkit";
import type { Token } from "../language/tokens.js";
import { prepareDoc } from "../prepare/prepare-doc.js";
import { findUiLabels } from "./ui-label-format.js";

interface Prepared {
  readonly tokens: readonly Token[];
  readonly source: string;
}

function prepared(text: string): Prepared {
  const doc = prepareDoc(text + "\n", "markdown");
  if (doc.kind !== "prepared") {
    throw new Error("expected a prepared doc");
  }
  const tokens = doc.blocks.flatMap((b) =>
    b.sentences.flatMap((s) => s.tokens),
  );
  return { tokens, source: doc.parsed.source };
}

function timed(
  build: (size: number) => string,
  sizes: readonly [number, number, number],
): void {
  expectLinearTime({
    prepare: (size) => {
      const { tokens, source } = prepared(build(size));
      return () => findUiLabels(tokens, source);
    },
    probe: { size: 1000, limitMs: 200 },
    sizes,
    smallLimitMs: 200,
    largeLimitMs: 100,
    slack: 4,
    floorMs: 20,
  });
}

describe("findUiLabels timing", () => {
  it("stays linear for a sentence of many select words", () => {
    timed((size) => "select ".repeat(size), [4000, 8000, 16000]);
  });

  it("stays linear for many opening quotes with no closing quote", () => {
    // Curly openers: no closer ever appears, so every scan runs to its limit.
    const open = String.fromCodePoint(0x201c);
    timed((size) => `Select ${open}Save `.repeat(size), [2000, 4000, 8000]);
    timed((size) => `Select ${open}`.repeat(size) + "Save", [2000, 4000, 8000]);
  });

  it("stays linear for many verbs each followed by a bold placeholder", () => {
    const label = "Word ".repeat(4) + "Word";
    timed((size) => `Select **${label}** `.repeat(size), [1000, 2000, 4000]);
  });

  it("stays linear for many verbs each followed by long code", () => {
    timed(
      (size) => `Select \`${"A".repeat(300)}\` `.repeat(size),
      [500, 1000, 2000],
    );
  });

  it("stays linear for many verbs each followed by a long shortcode", () => {
    timed(
      (size) => `Select {{< ui text="${"A".repeat(300)}" >}} `.repeat(size),
      [500, 1000, 2000],
    );
  });
});

describe("findUiLabels bounded reads", () => {
  it("reads only a short prefix of a shortcode", () => {
    const padded = "{{<" + " ".repeat(30) + 'ui text="A" >}}';
    const { tokens, source } = prepared(`Select ${padded}.`);
    expect(findUiLabels(tokens, source)).toEqual([]);
    const near = prepared("Select {{<" + " ".repeat(5) + 'ui text="A" >}}.');
    expect(findUiLabels(near.tokens, near.source)).toHaveLength(1);
  });

  it("does not look for a first letter past 200 characters", () => {
    const { tokens, source } = prepared(
      "Select **" + "1 ".repeat(300) + "Save**.",
    );
    expect(findUiLabels(tokens, source)).toEqual([]);
  });

  it("gives an answer for hostile shapes without throwing", () => {
    for (const text of [
      "select ".repeat(500),
      "**".repeat(500),
      "Select " + '"'.repeat(500),
      "Select\n".repeat(500),
    ]) {
      const { tokens, source } = prepared(text);
      expect(() => findUiLabels(tokens, source)).not.toThrow();
    }
  });
});
