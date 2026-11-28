import { expectLinearTime } from "@tulis/testkit";
import { describe, it } from "vitest";
import { prepareDoc, type PreparedDoc } from "../prepare/prepare-doc.js";
import { createCodeShellPromptExtractor } from "./code-shell-prompt-extractor.js";
import { findCodeBlocks } from "./find-code-blocks.js";

function prepared(text: string): PreparedDoc {
  const doc = prepareDoc(text, "markdown");
  if (doc.kind !== "prepared") throw new Error("not prepared");
  return doc;
}

/** Each run uses a shallow copy of the doc, so the cache never answers. */
function prepareFind(build: (size: number) => string) {
  return (size: number) => {
    const doc = prepared(build(size));
    const run = () => findCodeBlocks({ ...doc });
    run();
    return run;
  };
}

function prepareShell(build: (size: number) => string) {
  return (size: number) => {
    const doc = prepared(build(size));
    const extractor = createCodeShellPromptExtractor();
    const run = () => extractor.extract({ ...doc });
    run();
    return run;
  };
}

const options = {
  smallLimitMs: 50,
  largeLimitMs: 50,
  slack: 4,
  floorMs: 5,
} as const;

describe("code block scanning is linear", () => {
  // Preparing large docs is slow on CI; only the scan is timed.
  it("many small fenced blocks", { timeout: 30_000 }, () => {
    expectLinearTime({
      prepare: prepareFind((n) => "```sh\nx\n```\n\n".repeat(n)),
      probe: { size: 4000, limitMs: 50 },
      sizes: [500, 1000, 4000],
      ...options,
    });
  });

  it("one shell block with many comment lines", { timeout: 30_000 }, () => {
    expectLinearTime({
      prepare: prepareShell((n) => "```sh\n" + "# c\n".repeat(n) + "```\n"),
      probe: { size: 8000, limitMs: 50 },
      sizes: [1000, 2000, 8000],
      ...options,
    });
  });

  // Guard only: the first line decides, so only a mutant that does quadratic
  // work on that line could fail this; linear one-off reads of the line pass.
  it(
    "one shell block with one very long first line",
    { timeout: 30_000 },
    () => {
      expectLinearTime({
        prepare: prepareShell(
          (n) => "```sh\n" + "ab ".repeat(n) + "\nx\n".repeat(n) + "```\n",
        ),
        probe: { size: 50_000, limitMs: 50 },
        sizes: [6000, 12_000, 50_000],
        ...options,
      });
    },
  );
});
