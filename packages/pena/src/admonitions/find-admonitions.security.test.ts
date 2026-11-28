import { expectLinearTime } from "@tulis/testkit";
import { describe, it } from "vitest";
import { prepareDoc, type PreparedDoc } from "../prepare/prepare-doc.js";
import { findAdmonitions } from "./find-admonitions.js";

function build(text: string): PreparedDoc {
  const result = prepareDoc(text, "markdown");
  if (result.kind !== "prepared") {
    throw new Error("expected a prepared doc");
  }
  return result;
}

/** Each run uses a fresh doc object so the per-doc cache is not hit. */
function timed(text: string): () => unknown {
  const doc = build(text);
  return () => findAdmonitions({ ...doc });
}

const limits = {
  slack: 4,
  floorMs: 5,
  smallLimitMs: 60,
  largeLimitMs: 150,
};

// These tests prepare docs of up to a few thousand blocks outside the timer.
describe("findAdmonitions is linear on hostile input", () => {
  it("many blockquote notes", { timeout: 30_000 }, () => {
    expectLinearTime({
      prepare: (size) => timed("> **Note:** Body\n\n".repeat(size)),
      probe: { size: 2000, limitMs: 60 },
      sizes: [250, 500, 1000],
      ...limits,
    });
  });

  it(
    "one paragraph of many lines starting a tag with no end",
    { timeout: 30_000 },
    () => {
      expectLinearTime({
        prepare: (size) =>
          // ">" filler makes a search that runs on past the line slow (many
          // near-matches of ">}}"), so a missing line or 1,000 character bound shows.
          timed(("{{< note " + ">".repeat(90) + "\n").repeat(size)),
        probe: { size: 1000, limitMs: 40 },
        sizes: [500, 1000, 2000],
        ...limits,
      });
    },
  );

  it("one long line after an unfinished tag", { timeout: 30_000 }, () => {
    expectLinearTime({
      prepare: (size) => timed("{{< note " + "a".repeat(size)),
      probe: { size: 20000, limitMs: 60 },
      sizes: [20000, 80000, 200000],
      ...limits,
    });
  });

  it("an alert opener followed by many letters", { timeout: 30_000 }, () => {
    expectLinearTime({
      prepare: (size) => timed("> [!" + "a".repeat(size)),
      probe: { size: 10000, limitMs: 60 },
      sizes: [10000, 40000, 100000],
      ...limits,
    });
  });

  it("many older directive paragraphs with text", { timeout: 30_000 }, () => {
    expectLinearTime({
      prepare: (size) => timed(":::tip x\n\n".repeat(size)),
      probe: { size: 3000, limitMs: 80 },
      sizes: [500, 1000, 2000],
      ...limits,
    });
  });
});
