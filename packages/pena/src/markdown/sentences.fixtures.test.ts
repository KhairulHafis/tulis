import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseMarkdown, type ParsedMarkdown } from "./parse-markdown.js";
import {
  collectProseBlocks,
  proseUnit,
  type ProseUnitKind,
} from "./prose-units.js";
import { SourceLines } from "./source-lines.js";

/** Sentence text, first line, last line (1-based, in the LF fixture). */
type Expected = readonly [text: string, first: number, last: number];
type ExpectedUnit = readonly [kind: ProseUnitKind, sentences: Expected[]];

const h = (text: string, line: number): ExpectedUnit => [
  "heading",
  [[text, line, line]],
];

const EXPECTED: readonly ExpectedUnit[] = [
  h("Wrapped sentence", 1),
  [
    "paragraph",
    [
      [
        "This sentence is wrapped over three lines so that the splitter\nhas to treat each soft wrap as plain whitespace and keep going\nuntil the full stop at the end.",
        3,
        5,
      ],
    ],
  ],
  h("Second sentence on a wrapped line", 7),
  [
    "paragraph",
    [
      ["The first sentence ends near the end of this line.", 9, 9],
      ["The second\none starts on a wrapped line and ends here.", 9, 10],
    ],
  ],
  h("Abbreviation before lowercase", 12),
  ["paragraph", [["Use a tool, e.g.\npandoc, to convert the file.", 14, 15]]],
  h("Abbreviation before capital", 17),
  ["paragraph", [["Use a tool, e.g.\nPandoc, to convert the file.", 19, 20]]],
  h("Inline code with dots", 22),
  [
    "paragraph",
    [
      ["Run {CODE} first.", 24, 24],
      ["Then open {CODE} in a browser.", 24, 24],
    ],
  ],
  h("Link with dots", 26),
  [
    "paragraph",
    [
      ["Read the docs.example guide first.", 28, 28],
      ["Then continue.", 28, 28],
    ],
  ],
  h("Bare URL", 30),
  [
    "paragraph",
    [
      ["See {URL}.", 32, 32],
      ["Then restart the app.", 32, 32],
    ],
  ],
  h("Bold UI label", 34),
  [
    "paragraph",
    [
      ["Select {UI}.", 36, 36],
      ["Then close the dialog.", 36, 36],
    ],
  ],
  h("Shortcode mid-sentence", 38),
  [
    "paragraph",
    [
      ["Add the {SHORTCODE} page to your menu.", 40, 40],
      ["Then publish it.", 40, 40],
    ],
  ],
  h("Shortcode after a dot", 42),
  [
    "paragraph",
    [
      ["Open the page.", 44, 44],
      ["{SHORTCODE} Then publish it.", 44, 44],
    ],
  ],
  h("Liquid tag", 46),
  [
    "paragraph",
    [
      ["Set the value {SHORTCODE} before you start.", 48, 48],
      ["Then save.", 48, 48],
    ],
  ],
  h("Numbers", 50),
  [
    "paragraph",
    [
      ["Version 2.4.1 is out.", 52, 52],
      ["It scales to 3.5 times the old limit.", 52, 52],
    ],
  ],
  h("Note paragraph", 54),
  [
    "paragraph",
    [
      ["Note: Back up your files first.", 56, 56],
      ["Then start the upgrade.", 56, 56],
    ],
  ],
  h("Quoted sentence", 58),
  [
    "paragraph",
    [
      ['She said "Stop here."', 60, 60],
      ["Then she left the room.", 60, 60],
    ],
  ],
  h("Parenthetical sentence", 62),
  [
    "paragraph",
    [
      ["Start the agent.", 64, 64],
      ["(It takes a few seconds.)", 64, 64],
      ["Then check the log.", 64, 64],
    ],
  ],
  h("Question, exclamation and ellipsis", 66),
  [
    "paragraph",
    [
      ["Did it work?", 68, 68],
      ["Yes!", 68, 68],
      ["It did...", 68, 68],
      ["Then we shipped it.", 68, 68],
    ],
  ],
  h("etc followed by a capital", 70),
  [
    "paragraph",
    [
      ["Install the usual tools, etc.", 72, 72],
      ["Then restart the machine.", 72, 72],
    ],
  ],
  h("Dotted letters and initials", 74),
  [
    "paragraph",
    [
      ["The U.S. team met J. Smith on Monday.", 76, 76],
      ["They agreed on the plan.", 76, 76],
    ],
  ],
  h("Footnote reference after a dot", 78),
  [
    "paragraph",
    [
      ["The agent is ready.", 80, 80],
      ["Next, start the service.", 80, 80],
    ],
  ],
  h("Image in a sentence", 82),
  [
    "paragraph",
    [
      ["Click the icon {IMAGE} to open settings.", 84, 84],
      ["Then pick a theme.", 84, 84],
    ],
  ],
  h("Two-space hard break", 86),
  [
    "paragraph",
    [
      ["First line of the poem.", 88, 88],
      ["Second line of the poem.", 89, 89],
    ],
  ],
  h("Backslash hard break", 91),
  [
    "paragraph",
    [
      ["First line here", 93, 93],
      ["Second line here", 94, 94],
    ],
  ],
  h("Table with a line break", 96),
  ["tableCell", [["Name", 98, 98]]],
  ["tableCell", [["Notes", 98, 98]]],
  ["tableCell", [["Alpha", 100, 100]]],
  [
    "tableCell",
    [
      ["One note.", 100, 100],
      ["Another note.", 100, 100],
    ],
  ],
  ["tableCell", [["Beta", 101, 101]]],
  [
    "tableCell",
    [
      ["Short.", 101, 101],
      ["Longer one.", 101, 101],
    ],
  ],
  h("List with two sentences per item", 103),
  [
    "paragraph",
    [
      ["Install the agent.", 105, 105],
      ["Then start it.", 105, 105],
    ],
  ],
  [
    "paragraph",
    [
      ["Open the log.", 106, 106],
      ["Read the last lines.", 106, 106],
    ],
  ],
  h("Wrapped blockquote", 108),
  [
    "paragraph",
    [
      [
        "This quote is wrapped over two lines, so the splitter has to\njoin them.",
        110,
        111,
      ],
      ["Then it finds the second sentence.", 111, 111],
    ],
  ],
  h("Footnote definition", 113),
  ["paragraph", [["Some text.", 115, 115]]],
  [
    "paragraph",
    [
      ["The first note.", 117, 117],
      ["It has two sentences.", 117, 117],
    ],
  ],
  ["paragraph", [["A second note.", 118, 118]]],
  h("Container directive", 120),
  [
    "paragraph",
    [
      ["Back up first.", 123, 123],
      ["Then upgrade.", 123, 123],
    ],
  ],
  h("Code block", 126),
  h("HTML block", 132),
  h("Step 1. Install the agent", 138),
  ["paragraph", [["Done.", 140, 140]]],
];

function readFixture(name: string): string {
  const path = fileURLToPath(new URL("./fixtures/" + name, import.meta.url));
  return readFileSync(path, "utf8").replaceAll("\r\n", "\n");
}

function parse(text: string): ParsedMarkdown {
  const result = parseMarkdown(text, "markdown");
  if (result.kind !== "parsed") {
    throw new Error("did not parse: " + result.message);
  }
  return result;
}

function unitsOf(parsed: ParsedMarkdown) {
  return collectProseBlocks(parsed.tree).map((block) =>
    proseUnit(block, parsed),
  );
}

function summarise(parsed: ParsedMarkdown): ExpectedUnit[] {
  const lines = new SourceLines(parsed.source);
  return unitsOf(parsed).map((unit): ExpectedUnit => [
    unit.kind,
    unit.sentences.map((sentence): Expected => [
      sentence.text,
      lines.at(sentence.source.start).line,
      lines.at(sentence.source.end - 1).line,
    ]),
  ]);
}

describe("sentence fixtures", () => {
  const lf = readFixture("sentences.md");

  it("keeps the two trailing spaces of the hard break fixture", () => {
    // An editor that strips trailing whitespace would turn the case into a soft wrap.
    expect(lf.split("\n")).toContain("First line of the poem.  ");
  });

  it("matches the hand-written expectations", () => {
    expect(summarise(parse(lf))).toEqual(EXPECTED);
  });

  it("gives the same lines and slices with CRLF line endings", () => {
    const lfParsed = parse(lf);
    const crlfParsed = parse(lf.replaceAll("\n", "\r\n"));
    const lfUnits = unitsOf(lfParsed);
    const crlfUnits = unitsOf(crlfParsed);
    const crlfSummary = summarise(crlfParsed);
    const lfSummary = summarise(lfParsed);
    // Sentence text keeps soft-wrap line endings, so compare line numbers.
    expect(
      crlfSummary.map(([kind, s]) => [kind, s.map((x) => x.slice(1))]),
    ).toEqual(lfSummary.map(([kind, s]) => [kind, s.map((x) => x.slice(1))]));
    expect(crlfUnits).toHaveLength(lfUnits.length);
    lfUnits.forEach((lfUnit, index) => {
      const crlfUnit = crlfUnits[index];
      expect(crlfUnit?.sentences).toHaveLength(lfUnit.sentences.length);
      lfUnit.sentences.forEach((sentence, at) => {
        const other = crlfUnit?.sentences[at];
        if (other === undefined) {
          throw new Error("missing sentence");
        }
        const lfSlice = lfParsed.source.slice(
          sentence.source.start,
          sentence.source.end,
        );
        const crlfSlice = crlfParsed.source
          .slice(other.source.start, other.source.end)
          .replaceAll("\r\n", "\n");
        expect(crlfSlice).toBe(lfSlice);
      });
    });
  });
});
