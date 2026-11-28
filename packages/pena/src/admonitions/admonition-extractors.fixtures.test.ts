import { describe, expect, it } from "vitest";
import { createExtractorRegistry } from "../extract/registry.js";
import { runExtractors } from "../extract/run-extractors.js";
import type { MarkdownSyntax } from "../markdown/parse-markdown.js";
import { prepareDoc } from "../prepare/prepare-doc.js";
import { createAdmonitionLabelFormatExtractor } from "./admonition-label-format-extractor.js";
import { createAdmonitionSyntaxExtractor } from "./admonition-syntax-extractor.js";
import { findAdmonitions } from "./find-admonitions.js";

interface Row {
  readonly n: number;
  readonly doc: string;
  readonly s: readonly string[];
  readonly l: readonly string[];
  readonly syntax?: MarkdownSyntax;
}

const rows: readonly Row[] = [
  {
    n: 1,
    doc: "> **Note:** Body",
    s: ["blockquote-label"],
    l: ["title-case-colon"],
  },
  {
    n: 2,
    doc: "> **Note**: Body",
    s: ["blockquote-label"],
    l: ["title-case-colon"],
  },
  {
    n: 3,
    doc: "> **WARNING:** Body",
    s: ["blockquote-label"],
    l: ["upper-case-colon"],
  },
  { n: 4, doc: "> **Tip** Body", s: ["blockquote-label"], l: ["title-case"] },
  { n: 5, doc: "> **note:** Body", s: ["blockquote-label"], l: [] },
  { n: 6, doc: "> [!NOTE]\n> Body", s: ["github-alert"], l: [] },
  { n: 7, doc: "> [!note]\n> Body", s: ["github-alert"], l: [] },
  { n: 8, doc: "> [!flag]\n> Body", s: ["github-alert"], l: [] },
  { n: 9, doc: "> [!NOTE] Body same line", s: ["github-alert"], l: [] },
  { n: 10, doc: "> [!NOTE]x", s: [], l: [] },
  { n: 11, doc: ":::note\n\nBody\n\n:::", s: ["directive"], l: [] },
  { n: 12, doc: ":::tip[My title]\n\nBody\n\n:::", s: ["directive"], l: [] },
  { n: 13, doc: ":::tip My title\n\nBody\n\n:::", s: ["directive"], l: [] },
  { n: 14, doc: ":::details\n\nBody\n\n:::", s: [], l: [] },
  {
    n: 15,
    doc: "{{< note >}}\nBody text.\n{{< /note >}}",
    s: ["hugo-shortcode"],
    l: [],
  },
  {
    n: 16,
    doc: 'Intro line.\n{{% alert title="Note" %}}\nBody\n{{% /alert %}}',
    s: ["hugo-shortcode"],
    l: [],
  },
  { n: 17, doc: "{{<note>}}\nBody\n{{</note>}}", s: ["hugo-shortcode"], l: [] },
  {
    n: 18,
    doc: '{{< feature-state for_k8s_version="v1.30" state="beta" >}}',
    s: [],
    l: [],
  },
  {
    n: 20,
    doc: "**Note:** Body",
    s: ["paragraph-label"],
    l: ["title-case-colon"],
  },
  {
    n: 21,
    doc: "**IMPORTANT:** Body",
    s: ["paragraph-label"],
    l: ["upper-case-colon"],
  },
  {
    n: 22,
    doc: "1. Step\n\n   **Note:** Body",
    s: ["paragraph-label"],
    l: ["title-case-colon"],
  },
  { n: 23, doc: "**Example:** Body", s: [], l: [] },
  { n: 24, doc: "**Note: see below**", s: [], l: [] },
  {
    n: 25,
    doc: "> Quote\n>\n> **Note:** Body",
    s: ["paragraph-label"],
    l: ["title-case-colon"],
  },
  { n: 26, doc: "> [!NOTE]\n> **Note:** Body", s: ["github-alert"], l: [] },
  { n: 27, doc: ":::note\n\n**Note:** Body\n\n:::", s: ["directive"], l: [] },
  {
    n: 28,
    doc: "<!-- tulis-ignore -->\n> **Note:** Body\n\nText.",
    s: [],
    l: [],
  },
  {
    n: 29,
    doc: "> **Note:** A\n\n{{< warning >}}\nB\n{{< /warning >}}\n\n:::tip\n\nC\n\n:::",
    s: ["blockquote-label", "hugo-shortcode", "directive"],
    l: ["title-case-colon"],
  },
  { n: 30, doc: "`{{< note >}}`", s: [], l: [] },
  { n: 31, doc: "```\n{{< note >}}\n```", s: [], l: [] },
  { n: 32, doc: "> - {{< note >}}\n>   Body", s: ["hugo-shortcode"], l: [] },
  {
    n: 33,
    doc: "<Tabs>\n\n> **Note:** Body\n\n</Tabs>",
    s: [],
    l: [],
    syntax: "mdx",
  },
];

function values(doc: string, syntax: MarkdownSyntax, id: string): string[] {
  const prepared = prepareDoc(doc, syntax);
  if (prepared.kind !== "prepared") {
    throw new Error("skipped: " + prepared.reason);
  }
  const result = runExtractors(
    createExtractorRegistry([
      createAdmonitionSyntaxExtractor(),
      createAdmonitionLabelFormatExtractor(),
    ]),
    prepared,
  );
  expect(result.problems).toEqual([]);
  return result.observations
    .filter((o) => o.dimension === id)
    .map((o) => o.value);
}

describe("admonition fixtures", () => {
  for (const row of rows) {
    it("row " + String(row.n), () => {
      const syntax = row.syntax ?? "markdown";
      expect(values(row.doc, syntax, "admonition.syntax")).toEqual(row.s);
      expect(values(row.doc, syntax, "admonition.label-format")).toEqual(row.l);
    });
  }

  it("row 19: an MDX doc with a Hugo tag", () => {
    const result = prepareDoc("{{< note >}}\nBody\n{{< /note >}}", "mdx");
    if (result.kind === "skipped") {
      expect(result.reason).toBe("invalid-mdx");
    } else {
      expect(
        values("{{< note >}}\nBody\n{{< /note >}}", "mdx", "admonition.syntax"),
      ).toEqual([]);
    }
  });

  it("kinds of rows 7, 8, 12, 13 and 16", () => {
    const kinds = (text: string): string[] => {
      const doc = prepareDoc(text, "markdown");
      if (doc.kind !== "prepared") throw new Error("skipped");
      return findAdmonitions(doc).map((a) => a.kind);
    };
    expect(kinds("> [!note]\n> Body")).toEqual(["note"]);
    expect(kinds("> [!flag]\n> Body")).toEqual(["flag"]);
    expect(kinds(":::tip[My title]\n\nBody\n\n:::")).toEqual(["tip"]);
    expect(kinds(":::tip My title\n\nBody\n\n:::")).toEqual(["tip"]);
    expect(
      kinds('Intro line.\n{{% alert title="Note" %}}\nBody\n{{% /alert %}}'),
    ).toEqual(["alert"]);
  });
});
