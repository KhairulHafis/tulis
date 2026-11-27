import { describe, expect, it } from "vitest";
import { expectLinearTime, repeatToSize, timeOnce } from "@tulis/testkit";
import { findTemplateTags } from "./template-tags.js";

const cases: [string, string][] = [
  ["repeated unclosed {{<", "{{< "],
  ["repeated {% with text and no closer", "{% some text "],
  ["mixed openers without closers", "{{< {{% {{ {% "],
  ["openers followed by 999 characters", "{{<" + "a".repeat(996)],
  ["a run of braces", "{"],
];

// Cases (a) to (c) and the brace run take the slow path if the closer search
// restarts at every opener. Case (d) has only about 1,000 openers per MB, so
// it is a guard against a cap-less search, not a proof.
describe("findTemplateTags on hostile input", () => {
  for (const [name, unit] of cases) {
    it("stays linear for " + name, () => {
      // Probe first, with a tight limit, so a quadratic regression fails there
      // in well under a second instead of grinding through the 1 MB input.
      expectLinearTime({
        prepare: (size) => {
          const source = repeatToSize(unit, size);
          return () => findTemplateTags(source);
        },
        probe: { size: 16 * 1024, limitMs: 50 },
        sizes: [64 * 1024, 256 * 1024, 1024 * 1024],
        smallLimitMs: 100,
        largeLimitMs: 500,
        // Generous slack over linear, plus a floor for noise.
        slack: 4,
        floorMs: 50,
      });
    });
  }

  it("stays linear for 999-character openers with a far closer", () => {
    // A guard, not a proof: with only about 260 openers here, even a search
    // that restarts at every opener stays under the limit.
    const source = repeatToSize("{{<" + "a".repeat(996), 256 * 1024) + ">}}";
    expect(timeOnce(() => findTemplateTags(source))).toBeLessThan(100);
  });

  it("stays linear for many blank-line candidates", () => {
    const source =
      "{{< x\n" + " ".repeat(500) + "\n".repeat(1) + "a\n".repeat(200000);
    expect(timeOnce(() => findTemplateTags(source))).toBeLessThan(500);
  });
});
