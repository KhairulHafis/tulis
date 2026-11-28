import { describe, expect, it } from "vitest";
import type { DocumentExtractor } from "../extract/extractor.js";
import { createExtractorRegistry } from "../extract/registry.js";
import { runExtractors } from "../extract/run-extractors.js";
import type { MarkdownSyntax } from "../markdown/parse-markdown.js";
import { prepareDoc } from "../prepare/prepare-doc.js";
import {
  createShapeHeadingSkipExtractor,
  createShapeIntroExtractor,
  createShapeSectionsExtractor,
} from "./shape-extractors.js";

interface Seen {
  readonly values: string[];
  readonly slices: string[];
}

function run(
  extractor: DocumentExtractor,
  text: string,
  syntax: MarkdownSyntax = "markdown",
): Seen {
  const doc = prepareDoc(text, syntax);
  if (doc.kind !== "prepared") {
    throw new Error("skipped");
  }
  const result = runExtractors(createExtractorRegistry([extractor]), doc);
  expect(result.problems).toEqual([]);
  return {
    values: result.observations.map((o) => o.value),
    slices: result.observations.map((o) =>
      doc.parsed.source.slice(o.range.start, o.range.end),
    ),
  };
}

const GITLAB =
  "---\ntitle: Foo\n---\n\n{{< details >}}\n\n- Tier: Free\n\n{{< /details >}}\n\nIntro text.\n\n## Prerequisites\n";
const K8S =
  '---\ntitle: Foo\n---\n\n{{< feature-state for_k8s_version="v1.29" state="beta" >}}\n\n<!-- overview -->\n\nIntro.\n\n## {{% heading "prerequisites" %}}\n\n### Deep\n';

describe("shape.intro", () => {
  const rows: [string, string, string | undefined, string?][] = [
    ["# Title\n\nIntro.\n\n## A\n", "yes", "Intro."],
    ["# Title\n\n## A\n\nText.\n", "no", "## A"],
    ["---\ntitle: T\n---\n\nIntro.\n", "yes", "Intro."],
    [GITLAB, "yes", "Intro text."],
    [K8S, "yes", "Intro."],
    ["# T\n\n{{< note >}}\nCareful.\n{{< /note >}}\n\nText.\n", "yes", "Text."],
    ["# T\n\n> [!NOTE]\n> Careful.\n\nText.\n", "yes", "Text."],
    ["# T\n\n> [!NOTE]\n> Careful.\n\n## A\n", "no", "## A"],
    ["# T\n\n**Note:** Careful.\n", "none", undefined],
    [
      "---\ntitle: T\n---\n\n{{< details >}}\n\n- Tier: Free\n\n{{< /details >}}\n\n> [!flag]\n> Behind a flag.\n\n<!-- c -->\n\n> [!warning]\n> Careful.\n\nIntro.\n",
      "yes",
      "Intro.",
    ],
    ["# T\n\n:::note\nCareful.\n:::\n\nIntro.\n", "yes", "Intro."],
    ["# T\n\n**Note:** Careful.\n\nText.\n", "yes", "Text."],
    ["# T\n", "none", undefined],
    ["Intro with no title.\n\n## A\n", "none", undefined],
    ["# T\n\n- item\n", "no", "- item"],
    ["# T\n\n{{< details >}}\n\n- Tier\n\n## A\n", "no", "- Tier"],
    ["Before.\n\n# T\n\nAfter.\n", "yes", "After."],
    [
      "---\ntitle: T\n---\n\n{{< details >}}\n\n- Tier\n\n{{< /details >}}\n\n## Prerequisites\n",
      "no",
      "## Prerequisites",
    ],
    [
      "# T\n\n{{% details %}}\n\nx\n\n{{% /details %}}\n\nIntro.\n",
      "yes",
      "Intro.",
    ],
    [
      '# T\n\n{{< ui text="A" >}} {{< ui text="B" >}}\n\nText.\n',
      "yes",
      "Text.",
    ],
    ["# T\n\n<!-- tulis-ignore -->\n\nHidden.\n\nText.\n", "none", undefined],
    ["# T\n\n```sh\nls\n```\n", "no", "```sh\nls\n```"],
    [
      '---\ntitle: T\n---\n\nimport X from "y";\n\nIntro.\n',
      "yes",
      "Intro.",
      "mdx",
    ],
  ];
  for (const [text, value, slice, syntax] of rows) {
    it(`${JSON.stringify(text)} -> ${value}`, () => {
      const seen = run(
        createShapeIntroExtractor(),
        text,
        syntax === "mdx" ? "mdx" : "markdown",
      );
      if (value === "none") {
        expect(seen.values).toEqual([]);
      } else if (slice === undefined) {
        expect(seen.values).toEqual([value]);
      } else {
        expect(seen.values).toEqual([value]);
        expect(seen.slices).toEqual([slice]);
      }
    });
  }
});

describe("shape.heading-skip", () => {
  const rows: [string, string, string | undefined][] = [
    ["# T\n\n## A\n\n### B\n", "none", "## A"],
    ["# T\n\n## A\n\n#### B\n", "jump", "#### B"],
    ["---\ntitle: T\n---\n\n### A\n", "jump", "### A"],
    ["# T\n\nText.\n", "none recorded", undefined],
    ["## A\n\n#### B\n", "jump", "#### B"],
    ["## A\n", "none recorded", undefined],
    ["# T\n\n## A\n\n#### B\n\n#### C\n", "jump", "#### B"],
    ["# T\n\n## A\n\n### B\n\n## C\n\n### D\n", "none", "## A"],
    ["# T\n\n## A\n\n```md\n#### Not a heading\n```\n", "none", "## A"],
    ["# T\n\n# Second\n\n### X\n", "jump", "### X"],
    ["T\n=\n\nA\n---\n", "none", "A\n---"],
  ];
  for (const [text, value, slice] of rows) {
    it(`${JSON.stringify(text)} -> ${value}`, () => {
      const seen = run(createShapeHeadingSkipExtractor(), text);
      if (slice === undefined) {
        expect(seen.values).toEqual([]);
      } else {
        expect(seen.values).toEqual([value]);
        expect(seen.slices).toEqual([slice]);
      }
    });
  }

  it("records at most one finding", () => {
    const seen = run(
      createShapeHeadingSkipExtractor(),
      "# T\n\n## A\n\n#### B\n\n#### C\n",
    );
    expect(seen.values).toHaveLength(1);
  });
});

describe("shape.sections", () => {
  const rows: [string, string[]][] = [
    [
      "# T\n\n## Prerequisites\n\nx\n\n## Install the agent\n\n### Sub\n\n## Troubleshooting\n",
      ["prerequisites", "install the agent", "troubleshooting"],
    ],
    ["## Before you begin:\n", ["before you begin"]],
    ["##   Related   topics  \n", ["related topics"]],
    [
      '## {{% heading "prerequisites" %}}\n\n## {{< heading "whatsnext" >}}\n',
      ["prerequisites", "whatsnext"],
    ],
    ["## {{< note >}}\n", []],
    ["## `code` only\n", ["{code} only"]],
    ["## `code`\n", []],
    ["## Step 1.\n", ["step 1"]],
    ["## Install..\n", ["install."]],
    [
      "## Cafe" + String.fromCodePoint(0x301) + "\n",
      ["caf" + String.fromCodePoint(0xe9)],
    ],
    ["## " + "a".repeat(250) + "\n", []],
    ['## {{% heading "prerequisites" %}} extra\n', ["{shortcode} extra"]],
    ["# T\n\n### Only H3\n", []],
  ];
  for (const [text, values] of rows) {
    it(`${JSON.stringify(text.slice(0, 60))} -> ${JSON.stringify(values)}`, () => {
      expect(run(createShapeSectionsExtractor(), text).values).toEqual(values);
    });
  }

  it("comes out in page order", () => {
    const seen = run(
      createShapeSectionsExtractor(),
      "## Zeta\n\n## Alpha\n\n## Mid\n",
    );
    expect(seen.values).toEqual(["zeta", "alpha", "mid"]);
    expect(seen.slices).toEqual(["## Zeta", "## Alpha", "## Mid"]);
  });

  it("records nothing for an ignored H2", () => {
    const seen = run(
      createShapeSectionsExtractor(),
      "## Kept\n\n<!-- tulis-ignore -->\n\n## Hidden\n\n## Also kept\n",
    );
    expect(seen.values).toEqual(["kept", "also kept"]);
  });
});

describe("extractor ids", () => {
  it("use the shape ids and document scope", () => {
    for (const [extractor, id] of [
      [createShapeIntroExtractor(), "shape.intro"],
      [createShapeHeadingSkipExtractor(), "shape.heading-skip"],
      [createShapeSectionsExtractor(), "shape.sections"],
    ] as const) {
      expect(extractor.id).toBe(id);
      expect(extractor.scope).toBe("document");
    }
  });
});
