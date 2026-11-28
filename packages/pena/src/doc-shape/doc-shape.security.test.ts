import { expectLinearTime } from "@tulis/testkit";
import { describe, it } from "vitest";
import { prepareDoc, type PreparedDoc } from "../prepare/prepare-doc.js";
import { findHeadingSkip } from "./heading-skip.js";
import { findIntro } from "./intro.js";
import { createShapeSectionsExtractor } from "./shape-extractors.js";

function build(text: string): PreparedDoc {
  const result = prepareDoc(text, "markdown");
  if (result.kind !== "prepared") {
    throw new Error("expected a prepared doc");
  }
  return result;
}

const limits = { slack: 4, floorMs: 5, smallLimitMs: 60, largeLimitMs: 150 };

describe("doc shape checks are linear on hostile input", () => {
  it(
    "opening tags with no closing tag (bounded look-ahead)",
    { timeout: 30_000 },
    () => {
      expectLinearTime({
        prepare: (size) => {
          const doc = build(
            "# T\n\n" + "{{< d >}}\n\n".repeat(size) + "Text.\n",
          );
          return () => findIntro({ ...doc });
        },
        probe: { size: 3000, limitMs: 400 },
        sizes: [250, 500, 2000],
        ...limits,
      });
    },
  );

  it("many note boxes before the first paragraph", { timeout: 30_000 }, () => {
    expectLinearTime({
      prepare: (size) => {
        const doc = build(
          "# T\n\n" + "> [!NOTE]\n> Careful.\n\n".repeat(size) + "Text.\n",
        );
        return () => findIntro({ ...doc });
      },
      probe: { size: 3000, limitMs: 400 },
      sizes: [250, 500, 2000],
      ...limits,
    });
  });

  it("thousands of headings (skip)", { timeout: 30_000 }, () => {
    expectLinearTime({
      prepare: (size) => {
        const doc = build("# T\n\n" + "## A\n\n### B\n\n".repeat(size));
        return () => findHeadingSkip({ ...doc });
      },
      probe: { size: 4000, limitMs: 80 },
      sizes: [500, 1000, 4000],
      ...limits,
    });
  });

  it("thousands of headings (sections)", { timeout: 30_000 }, () => {
    const extractor = createShapeSectionsExtractor();
    expectLinearTime({
      prepare: (size) => {
        const doc = build("## Section name\n\n".repeat(size));
        return () => extractor.extract({ ...doc });
      },
      probe: { size: 4000, limitMs: 80 },
      sizes: [500, 1000, 4000],
      ...limits,
    });
  });

  // The tag is at most 1,000 characters, so this is a guard against regex
  // blow-up on a mismatched, long argument, not a size-scaling proof.
  it("long heading tag arguments", { timeout: 30_000 }, () => {
    const extractor = createShapeSectionsExtractor();
    expectLinearTime({
      prepare: (size) => {
        const arg = "a".repeat(900);
        const doc = build(`## {{% heading "${arg}" >}}\n\n`.repeat(size));
        return () => extractor.extract({ ...doc });
      },
      probe: { size: 300, limitMs: 60 },
      sizes: [100, 200, 400],
      ...limits,
    });
  });
});
