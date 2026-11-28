import { describe, expect, it } from "vitest";
import { createExtractorRegistry } from "../extract/registry.js";
import { runExtractors } from "../extract/run-extractors.js";
import { prepareDoc } from "../prepare/prepare-doc.js";
import { createCodeFenceExtractor } from "./code-fence-extractor.js";
import { createCodeLangNameExtractor } from "./code-lang-name-extractor.js";
import { createCodeLangTagExtractor } from "./code-lang-tag-extractor.js";
import { createCodeShellPromptExtractor } from "./code-shell-prompt-extractor.js";

interface Answer {
  readonly fence: string[];
  readonly tag: string[];
  readonly name: string[];
  readonly prompt: string[];
}

function run(text: string, syntax: "markdown" | "mdx" = "markdown"): Answer {
  const doc = prepareDoc(text, syntax);
  if (doc.kind !== "prepared") throw new Error("not prepared");
  const result = runExtractors(
    createExtractorRegistry([
      createCodeFenceExtractor(),
      createCodeLangTagExtractor(),
      createCodeLangNameExtractor(),
      createCodeShellPromptExtractor(),
    ]),
    doc,
  );
  expect(result.problems).toEqual([]);
  const pick = (prefix: string) =>
    result.observations
      .filter((o) => o.dimension.startsWith(prefix))
      .map((o) => o.dimension + "=" + o.value);
  return {
    fence: pick("code.fence").map((s) => s.slice("code.fence=".length)),
    tag: pick("code.lang-tag").map((s) => s.slice("code.lang-tag=".length)),
    name: pick("code.lang-name"),
    prompt: pick("code.shell-prompt").map((s) =>
      s.slice("code.shell-prompt=".length),
    ),
  };
}

const none: Answer = { fence: [], tag: [], name: [], prompt: [] };

function one(
  fence: string,
  tag: string,
  name: string[],
  prompt: string[],
): Answer {
  return { fence: [fence], tag: [tag], name, prompt };
}

const CASES: readonly (readonly [
  number,
  string,
  Answer,
  ("markdown" | "mdx")?,
])[] = [
  [
    1,
    "```bash\nls\n```",
    one("backticks", "present", ["code.lang-name.shell=bash"], ["none"]),
  ],
  [
    2,
    "~~~yaml\na: 1\n~~~",
    one("tildes", "present", ["code.lang-name.yaml=yaml"], []),
  ],
  [
    3,
    "Text\n\n    ```\n    not a fence",
    { fence: ["indented"], tag: [], name: [], prompt: [] },
  ],
  [4, "```\nx\n```", one("backticks", "missing", [], [])],
  [
    5,
    '```Bash title="x"\n$ ls\n```',
    one("backticks", "present", ["code.lang-name.shell=bash"], ["dollar"]),
  ],
  [
    6,
    "```console\n# comment\n$ kubectl get pods\n```",
    one("backticks", "present", ["code.lang-name.shell=console"], ["dollar"]),
  ],
  [
    7,
    "```shell\n# only a comment\n```",
    one("backticks", "present", ["code.lang-name.shell=shell"], []),
  ],
  [
    8,
    "```sh\n\n  $ ls\n```",
    one("backticks", "present", ["code.lang-name.shell=sh"], ["dollar"]),
  ],
  [
    9,
    "```shell\n$HOME/bin/tool\n```",
    one("backticks", "present", ["code.lang-name.shell=shell"], ["none"]),
  ],
  [
    10,
    "```none\nplain\n```",
    one("backticks", "present", ["code.lang-name.text=none"], []),
  ],
  [11, "```json\n{}\n```", one("backticks", "present", [], [])],
  [
    12,
    "1. Step\n\n   ```bash\n   ls\n   ```",
    one("backticks", "present", ["code.lang-name.shell=bash"], ["none"]),
  ],
  [
    13,
    "> ~~~yaml\n> a: 1\n> ~~~",
    one("tildes", "present", ["code.lang-name.yaml=yaml"], []),
  ],
  [14, "<!-- tulis-ignore -->\n```bash\nls\n```\n\nText.", none],
  [15, "<Tabs>\n\n```bash\nls\n```\n\n</Tabs>", none, "mdx"],
  [
    16,
    "```YML\na: 1\n```",
    one("backticks", "present", ["code.lang-name.yaml=yml"], []),
  ],
  [
    17,
    "````md\n```js\nx\n```\n````",
    one("backticks", "present", ["code.lang-name.markdown=md"], []),
  ],
  [
    18,
    "```powershell\nPS> Get-Item\n```",
    one("backticks", "present", ["code.lang-name.powershell=powershell"], []),
  ],
  [
    19,
    "   ```go\nx\n```",
    one("backticks", "present", ["code.lang-name.go=go"], []),
  ],
  [
    20,
    "```shell\r\n$ ls\r\n```",
    one("backticks", "present", ["code.lang-name.shell=shell"], ["dollar"]),
  ],
  [
    21,
    "```bash\nls\n```\n\n~~~\nx\n~~~",
    {
      fence: ["backticks", "tildes"],
      tag: ["present", "missing"],
      name: ["code.lang-name.shell=bash"],
      prompt: ["none"],
    },
  ],
];

describe("code extractor fixtures", () => {
  for (const [number, text, expected, syntax] of CASES) {
    it(`case ${String(number)}`, () => {
      expect(run(text, syntax)).toEqual(expected);
    });
  }
});
