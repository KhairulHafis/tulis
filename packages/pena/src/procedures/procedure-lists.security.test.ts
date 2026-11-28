import { expectLinearTime } from "@tulis/testkit";
import { describe, expect, it } from "vitest";
import { prepareDoc, type PreparedDoc } from "../prepare/prepare-doc.js";
import { findProcedures } from "./procedure-lists.js";

function prepared(text: string): PreparedDoc {
  const doc = prepareDoc(text, "markdown");
  if (doc.kind !== "prepared") {
    throw new Error("not prepared");
  }
  return doc;
}

/** Each run uses a shallow copy of the doc, so the cache never answers. */
function prepareCheck(build: (size: number) => string) {
  return (size: number) => {
    const doc = prepared(build(size));
    const run = () => findProcedures({ ...doc });
    // The first run is cold (compiling, memory growth) and can take over 100 ms
    // on a busy machine; warm up so only the steady-state time is measured.
    run();
    return run;
  };
}

/** Many paragraphs, each followed by its own one-step procedure. */
function siblingLists(size: number): string {
  return "Then:\n\n1. Run it.\n\n".repeat(size);
}

/** Many paragraphs, then one list with many code-first items. */
function oneLongList(size: number): string {
  const items = "1. ```sh\n   x\n   ```\n".repeat(size);
  return "Text.\n\n".repeat(size) + "1. Run it.\n" + items;
}

describe("findProcedures is linear", () => {
  // Guard only: an `indexOf` for the previous sibling would be quadratic, but
  // prepareDoc is already quadratic in sibling blocks, so no input here is big
  // enough to show it. This checks growth, not that mutant.
  it("many sibling lists separated by paragraphs", () => {
    expectLinearTime({
      prepare: prepareCheck(siblingLists),
      probe: { size: 1000, limitMs: 50 },
      sizes: [125, 250, 500],
      smallLimitMs: 50,
      largeLimitMs: 50,
      slack: 4,
      floorMs: 5,
    });
  });

  // Preparing the large docs takes most of a second here and several on slow
  // CI machines; only findProcedures is timed, so the test limit is generous.
  it("one list with many items", { timeout: 30_000 }, () => {
    expectLinearTime({
      prepare: prepareCheck(oneLongList),
      probe: { size: 5000, limitMs: 50 },
      sizes: [625, 1250, 5000],
      smallLimitMs: 50,
      largeLimitMs: 50,
      slack: 4,
      floorMs: 5,
    });
  });

  it("deeply nested ordered lists finish and stay bounded", () => {
    const depth = 49;
    const lines: string[] = [];
    for (let level = 0; level < depth; level += 1) {
      lines.push("   ".repeat(level) + "1. Run it.");
      lines.push("   ".repeat(level) + "2. Stop it.");
    }
    const doc = prepared(lines.join("\n") + "\n");
    const started = performance.now();
    const procedures = findProcedures(doc);
    expect(performance.now() - started).toBeLessThan(500);
    expect(procedures.length).toBeLessThanOrEqual(depth);
    expect(procedures.length).toBeGreaterThan(0);
    expect(procedures.slice(1).every((p) => p.nested)).toBe(true);
  });
});
