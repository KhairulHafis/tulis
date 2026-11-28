import { expectLinearTime } from "@tulis/testkit";
import { describe, it } from "vitest";
import { prepareDoc, type PreparedDoc } from "../prepare/prepare-doc.js";
import { isIgnored, nodeRange, walkTree } from "./tree-walk.js";

function build(pairs: number): PreparedDoc {
  const unit =
    "<!-- tulis-ignore -->\n```bash\nls\n```\n\n```bash\npwd\n```\n\n";
  const result = prepareDoc(unit.repeat(pairs), "markdown");
  if (result.kind !== "prepared") {
    throw new Error("expected a prepared doc");
  }
  return result;
}

describe("isIgnored is logarithmic per call", () => {
  // Guard only: parsing costs more than the ignore test, so a linear scan per
  // call would still pass here; the synthetic test below proves the index.
  // Prepares docs of up to 1,000 comment and code block pairs (outside the timer).
  it("many ignore comments and many code blocks", { timeout: 30_000 }, () => {
    expectLinearTime({
      prepare: (size) => {
        const doc = build(size);
        isIgnored(doc, { start: 0, end: 1 });
        return () => {
          walkTree(doc, (node) => {
            const range = nodeRange(node);
            if (range !== undefined && node.type === "code") {
              isIgnored(doc, range);
            }
          });
        };
      },
      probe: { size: 150, limitMs: 100 },
      sizes: [250, 500, 1000],
      smallLimitMs: 100,
      largeLimitMs: 200,
      slack: 4,
      floorMs: 5,
    });
  });

  it(
    "many ranges, many probes (only isIgnored is timed)",
    { timeout: 30_000 },
    () => {
      const base = build(1);
      expectLinearTime({
        prepare: (size) => {
          // A fresh doc object per size, so the cached index is built in the
          // first call; the ranges are 10 wide with gaps, probes sit in the gaps
          // and in the ranges, the late ones last.
          const ranges = Array.from({ length: size }, (_, i) => ({
            kind: "next" as const,
            checks: [],
            reason: undefined,
            line: 1,
            start: i * 20,
            end: i * 20 + 10,
          }));
          const doc: PreparedDoc = { ...base, ignoredRanges: ranges };
          isIgnored(doc, { start: 0, end: 1 });
          return () => {
            for (let i = 0; i < size; i += 1) {
              isIgnored(doc, { start: i * 20 + 12, end: i * 20 + 15 });
            }
          };
        },
        probe: { size: 2000, limitMs: 100 },
        sizes: [2000, 8000, 16000],
        smallLimitMs: 100,
        largeLimitMs: 200,
        slack: 4,
        floorMs: 5,
      });
    },
  );
});
