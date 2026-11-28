import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { MarkdownSyntax } from "../markdown/parse-markdown.js";
import { prepareDoc, type PreparedDoc } from "./prepare-doc.js";

function readFixture(name: string): string {
  const path = fileURLToPath(new URL("./fixtures/" + name, import.meta.url));
  return readFileSync(path, "utf8").replaceAll("\r\n", "\n");
}

function prepare(name: string, text: string): PreparedDoc {
  const syntax: MarkdownSyntax = name.endsWith(".mdx") ? "mdx" : "markdown";
  const result = prepareDoc(text, syntax);
  if (result.kind !== "prepared") {
    throw new Error("expected a prepared doc, got " + result.reason);
  }
  return result;
}

interface Summary {
  readonly kind: string;
  readonly texts: string[];
  readonly lines: number[][];
}

function summary(doc: PreparedDoc): Summary[] {
  return doc.blocks.map((block) => ({
    kind: block.kind,
    texts: block.sentences.map((s) => s.text.replaceAll("\r\n", "\n")),
    lines: block.sentences.map((s) => [s.start.line, s.end.line]),
  }));
}

function kindsAndTexts(doc: PreparedDoc): [string, string[]][] {
  return summary(doc).map((b) => [b.kind, b.texts]);
}

function startLine(doc: PreparedDoc, block: number): number | undefined {
  return doc.blocks[block]?.sentences[0]?.start.line;
}

const NAMES = ["guide.md", "components.mdx", "hugo.md", "docusaurus.md"];

describe("guide.md", () => {
  const doc = prepare("guide.md", readFixture("guide.md"));

  it("has the expected title, warnings and check ignores", () => {
    expect(doc.title).toMatchObject({
      from: "frontmatter",
      text: "Install the agent",
      line: 1,
    });
    expect(doc.warnings).toEqual([]);
    expect(doc.checkIgnores).toHaveLength(1);
    expect(doc.checkIgnores[0]?.checks).toEqual(["term.sign-in"]);
    expect(doc.checkIgnores[0]?.line).toBe(13);
  });

  it("has the expected blocks", () => {
    expect(kindsAndTexts(doc)).toEqual([
      [
        "paragraph",
        [
          "Tulis checks your docs\nagainst the house style.",
          "It runs on your machine.",
        ],
      ],
      ["paragraph", ["Run {CODE} and click {UI}."]],
      ["paragraph", ["Sign in to the dashboard."]],
      ["tableCell", ["Option"]],
      ["tableCell", ["Meaning"]],
      ["tableCell", ["Fast"]],
      ["tableCell", ["Skips the slow checks."]],
      ["paragraph", ["See the setup guide or {URL} for more."]],
    ]);
  });

  it("has the expected positions and tokens", () => {
    const [first, second] = doc.blocks[0]?.sentences ?? [];
    expect(first?.start).toEqual({ line: 5, column: 1 });
    expect(first?.end).toEqual({ line: 6, column: 25 });
    expect(second?.start).toEqual({ line: 6, column: 26 });
    expect(second?.end).toEqual({ line: 6, column: 50 });
    expect(doc.blocks[1]?.sentences[0]?.tokens.map((t) => t.text)).toEqual([
      "Run",
      "{CODE}",
      "and",
      "click",
      "{UI}",
      ".",
    ]);
    expect(startLine(doc, 2)).toBe(14);
    expect(startLine(doc, 7)).toBe(24);
  });
});

describe("components.mdx", () => {
  const doc = prepare("components.mdx", readFixture("components.mdx"));

  it("has the expected title and blocks", () => {
    expect(doc.title).toEqual({
      from: "h1",
      text: "Configure the widget",
      line: 7,
    });
    expect(doc.warnings).toEqual([]);
    expect(doc.checkIgnores).toEqual([]);
    expect(kindsAndTexts(doc)).toEqual([
      ["heading", ["Configure the widget"]],
      ["paragraph", ["The widget reads its settings at startup."]],
      [
        "paragraph",
        ["Press {HTML} to confirm, then wait {SHORTCODE} seconds."],
      ],
    ]);
    expect(startLine(doc, 2)).toBe(20);
  });
});

describe("hugo.md", () => {
  const doc = prepare("hugo.md", readFixture("hugo.md"));

  it("has the expected frontmatter and title", () => {
    expect(doc.frontmatter?.format).toBe("toml");
    expect([...(doc.frontmatter?.fields ?? [])]).toEqual([
      ["title", "Deploy the site"],
    ]);
    expect(doc.title).toMatchObject({
      from: "frontmatter",
      text: "Deploy the site",
      line: 1,
    });
    expect(doc.warnings).toEqual([]);
  });

  it("has the expected blocks", () => {
    expect(kindsAndTexts(doc)).toEqual([
      [
        "paragraph",
        ["{SHORTCODE}\nBack up your content before you start.", "{SHORTCODE}"],
      ],
      ["paragraph", ["The build uses {SHORTCODE} by default."]],
      ["heading", ["Run the build"]],
      ["paragraph", ["Open a terminal."]],
      ["paragraph", ["Run {CODE} from the project folder."]],
    ]);
    const heading = doc.blocks[2]?.node;
    expect(heading?.type === "heading" ? heading.depth : undefined).toBe(2);
    expect(startLine(doc, 3)).toBe(14);
    expect(startLine(doc, 4)).toBe(15);
  });
});

describe("docusaurus.md", () => {
  const doc = prepare("docusaurus.md", readFixture("docusaurus.md"));

  it("has the expected title and blocks", () => {
    expect(doc.title).toEqual({ from: "h1", text: "Writing tips", line: 6 });
    expect(doc.warnings).toEqual([]);
    expect(kindsAndTexts(doc)).toEqual([
      ["heading", ["Writing tips"]],
      ["paragraph", ["Keep each step short."]],
      ["paragraph", ["Pro tip"]],
      ["paragraph", ["Use the {UI} button often."]],
      ["paragraph", ["Set the ratio to 3:1 and continue."]],
    ]);
    expect(startLine(doc, 1)).toBe(10);
    expect(startLine(doc, 2)).toBe(14);
    expect(startLine(doc, 3)).toBe(16);
    expect(startLine(doc, 4)).toBe(26);
  });
});

describe.each(NAMES)("%s variants", (name) => {
  const lf = readFixture(name);
  const base = prepare(name, lf);

  it("gives the same blocks for CRLF", () => {
    const doc = prepare(name, lf.replaceAll("\n", "\r\n"));
    expect(summary(doc)).toEqual(summary(base));
  });

  it("gives the same blocks for a BOM", () => {
    const doc = prepare(name, String.fromCodePoint(0xfeff) + lf);
    expect(summary(doc)).toEqual(summary(base));
  });

  it("survives structuredClone", () => {
    expect(structuredClone(base)).toEqual(base);
  });
});
