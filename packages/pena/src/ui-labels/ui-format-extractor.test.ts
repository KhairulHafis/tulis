import { describe, expect, it } from "vitest";
import { createExtractorRegistry } from "../extract/registry.js";
import { runExtractors } from "../extract/run-extractors.js";
import { prepareDoc } from "../prepare/prepare-doc.js";
import { createUiFormatExtractor } from "./ui-format-extractor.js";

/** Each finding as [value, source slice of its range]. */
function found(text: string): readonly (readonly [string, string])[] {
  const doc = prepareDoc(text, "markdown");
  if (doc.kind !== "prepared") {
    throw new Error("expected a prepared doc");
  }
  const result = runExtractors(
    createExtractorRegistry([createUiFormatExtractor()]),
    doc,
  );
  expect(result.problems).toEqual([]);
  return result.observations.map((o) => {
    expect(o.dimension).toBe("ui.format");
    return [o.value, doc.parsed.source.slice(o.range.start, o.range.end)];
  });
}

const CASES: readonly (readonly [
  string,
  readonly (readonly [string, string])[],
])[] = [
  ["Select **Save changes**.", [["bold", "Select **Save changes**"]]],
  ["Click on the **Save** button.", [["bold", "Click on the **Save**"]]],
  ['Select "Save".', [["quotes", 'Select "Save"']]],
  ["Click “Apply”.", [["quotes", "Click “Apply”"]]],
  ["Select 'Save'.", [["quotes", "Select 'Save'"]]],
  ["Select 'the' item.", []],
  ['Select "save".', []],
  ["Select “Save'.", []],
  ['Select the "Save button.', []],
  ['Select "Save this very long label that goes on and on and on" now.', []],
  [
    'Select "Save this long label" now.',
    [["quotes", 'Select "Save this long label"']],
  ],
  [
    "Select **Allow key administrators to delete this key now**.",
    [["bold", "Select **Allow"]],
  ],
  [
    'Select {{< ui text="Settings" >}} > **CI/CD**.',
    [["hugo-shortcode", 'Select {{< ui text="Settings" >}}']],
  ],
  ['Select {{< icon name="pencil" >}}.', []],
  ["Select `Manual job`.", [["code", "Select `Manual job`"]]],
  ["Select `main`.", []],
  ["Double-click **X**.", [["bold", "Double-click **X**"]]],
  ["In the left sidebar, select Settings.", [["plain", "select Settings"]]],
  ["Select Enable private DNS.", [["plain", "Select Enable"]]],
  ["You can select Settings.", []],
  ["Select the VPC endpoint.", []],
  [
    "Select Claude Haiku or GPT Mini for this project, which is the default.",
    [],
  ],
  ["Clear Gitaly and Gitaly Cluster (Praefect) data.", []],
  ["Select <kbd>Enter</kbd>.", []],
  ["Select *Italic*.", []],
  ["Select ***Both***.", [["bold", "Select ***Both**"]]],
  ["Select [Settings](x).", []],
  ["Check **Enable**.", []],
  ["Press **Enter**.", []],
  ["Open **Settings**.", []],
  ["Select a **Role**.", []],
  ["Click on on the **X**.", []],
  [
    "Select **A** and then click **B**.",
    [
      ["bold", "Select **A**"],
      ["bold", "click **B**"],
    ],
  ],
  ["Selects **X**.", []],
  ["SELECT **X**.", [["bold", "SELECT **X**"]]],
  ["Select **settings**.", []],
  ["Select\n**Wrapped**.", [["bold", "Select\n**Wrapped**"]]],
  [
    "| Select **Save** |\n|---|\n| Clear **X** |\n",
    [
      ["bold", "Select **Save**"],
      ["bold", "Clear **X**"],
    ],
  ],
  ["## Select **Save**\n", []],
  ["- Select **Save**.\n", [["bold", "Select **Save**"]]],
];

describe("createUiFormatExtractor", () => {
  it("has the right id, scope and block kinds", () => {
    const extractor = createUiFormatExtractor();
    expect(extractor.id).toBe("ui.format");
    expect(extractor.scope).toBe("sentence");
    expect(extractor.blockKinds).toEqual(["paragraph", "tableCell"]);
  });

  for (const [text, expected] of CASES) {
    it(`gives ${JSON.stringify(expected)} for ${JSON.stringify(text)}`, () => {
      expect(found(text)).toEqual(expected);
    });
  }
});
