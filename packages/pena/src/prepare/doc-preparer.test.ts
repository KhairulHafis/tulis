import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MarkdownSyntax } from "../markdown/parse-markdown.js";
import { createProductNameMatcher } from "../markdown/product-names.js";
import {
  createDocPreparer,
  PREPARE_TIME_LIMIT_MS,
  type DocPreparer,
} from "./doc-preparer.js";
import { prepareDoc } from "./prepare-doc.js";

function readFixture(name: string): string {
  const path = fileURLToPath(new URL("./fixtures/" + name, import.meta.url));
  return readFileSync(path, "utf8").replaceAll("\r\n", "\n");
}

interface Doc {
  readonly text: string;
  readonly syntax: MarkdownSyntax;
}

const docs: Record<string, Doc> = {
  guide: { text: readFixture("guide.md"), syntax: "markdown" },
  hugo: { text: readFixture("hugo.md"), syntax: "markdown" },
  docusaurus: { text: readFixture("docusaurus.md"), syntax: "markdown" },
  components: { text: readFixture("components.mdx"), syntax: "mdx" },
  nonEnglish: {
    text: "---\nlang: ja\n---\n\nText.\n",
    syntax: "markdown",
  },
  invalidMdx: { text: "Text.\n\n<div>\n\nMore.\n", syntax: "mdx" },
};

const open: DocPreparer[] = [];

function newPreparer(
  options?: Parameters<typeof createDocPreparer>[0],
): DocPreparer {
  const preparer = createDocPreparer(options);
  open.push(preparer);
  return preparer;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(open.splice(0).map((preparer) => preparer.close()));
});

describe("results", () => {
  it("matches prepareDoc for normal and skipped docs", async () => {
    const preparer = newPreparer();
    for (const doc of Object.values(docs)) {
      const result = await preparer.prepare(doc.text, doc.syntax);
      expect(result).toEqual(prepareDoc(doc.text, doc.syntax));
    }
    expect(prepareDoc(docs.nonEnglish?.text ?? "", "markdown")).toMatchObject({
      reason: "non-english",
    });
    expect(prepareDoc(docs.invalidMdx?.text ?? "", "mdx")).toMatchObject({
      reason: "invalid-mdx",
    });
  });

  it("masks product names with a matcher built in the worker", async () => {
    const names = ["Acme Cloud"];
    const text = "# Title\n\nAcme Cloud is fast. It runs on Acme Cloud.\n";
    const preparer = newPreparer({ productNames: names });
    const result = await preparer.prepare(text, "markdown");
    expect(result).toEqual(
      prepareDoc(text, "markdown", {
        productNames: createProductNameMatcher(names),
      }),
    );
    expect(result).not.toEqual(prepareDoc(text, "markdown"));
  });

  it("resolves calls made without awaiting in call order", async () => {
    const preparer = newPreparer();
    const list = [docs.guide, docs.components, docs.nonEnglish, docs.hugo];
    const order: number[] = [];
    const pending = list.map(async (doc, index) => {
      const result = await preparer.prepare(
        doc?.text ?? "",
        doc?.syntax ?? "markdown",
      );
      order.push(index);
      return result;
    });
    const results = await Promise.all(pending);
    expect(order).toEqual([0, 1, 2, 3]);
    results.forEach((result, index) => {
      const doc = list[index];
      expect(result).toEqual(
        prepareDoc(doc?.text ?? "", doc?.syntax ?? "markdown"),
      );
    });
  });
});

describe("time limit default", () => {
  it("is 10 seconds and used when no option is given", async () => {
    expect(PREPARE_TIME_LIMIT_MS).toBe(10_000);
    const spy = vi.spyOn(globalThis, "setTimeout");
    const preparer = newPreparer();
    await preparer.prepare("Text.\n", "markdown");
    const delays = spy.mock.calls.map((call) => call[1]);
    expect(delays).toContain(10_000);
  });
});

describe("close", () => {
  it("rejects prepare after close, and close twice is fine", async () => {
    const preparer = newPreparer();
    await preparer.prepare("Text.\n", "markdown");
    await preparer.close();
    await preparer.close();
    await expect(preparer.prepare("Text.\n", "markdown")).rejects.toThrow(
      /closed/,
    );
  });

  it("rejects calls that are queued or in flight", async () => {
    const preparer = newPreparer();
    const first = preparer.prepare("Text.\n", "markdown");
    const second = preparer.prepare("More.\n", "markdown");
    const firstOutcome = expect(first).rejects.toThrow(/closed/);
    const secondOutcome = expect(second).rejects.toThrow(/closed/);
    await preparer.close();
    await firstOutcome;
    await secondOutcome;
  });

  it("closes a preparer that never started a worker", async () => {
    const preparer = newPreparer();
    await preparer.close();
    await expect(preparer.prepare("Text.\n", "markdown")).rejects.toThrow(
      /closed/,
    );
  });
});
