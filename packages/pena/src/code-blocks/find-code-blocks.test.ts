import { describe, expect, it } from "vitest";
import { prepareDoc, type PreparedDoc } from "../prepare/prepare-doc.js";
import { codeFence, findCodeBlocks } from "./find-code-blocks.js";

function prepared(
  text: string,
  syntax: "markdown" | "mdx" = "markdown",
): PreparedDoc {
  const doc = prepareDoc(text, syntax);
  if (doc.kind !== "prepared") throw new Error("not prepared");
  return doc;
}

describe("codeFence", () => {
  it("reads backticks and tildes", () => {
    expect(codeFence("```js", 0)).toBe("backticks");
    expect(codeFence("~~~", 0)).toBe("tildes");
  });

  it("skips 0 to 3 spaces", () => {
    for (let n = 0; n <= 3; n += 1) {
      expect(codeFence(" ".repeat(n) + "```", 0)).toBe("backticks");
      expect(codeFence(" ".repeat(n) + "~~~", 0)).toBe("tildes");
    }
  });

  it("is indented after 4 spaces, after a tab, or with other text", () => {
    expect(codeFence("    ```", 0)).toBe("indented");
    expect(codeFence("\t```", 0)).toBe("indented");
    expect(codeFence("code", 0)).toBe("indented");
    expect(codeFence("``", 0)).toBe("indented");
  });

  it("works from an offset and at the end of the source", () => {
    expect(codeFence("ab ~~~", 2)).toBe("tildes");
    expect(codeFence("abc", 3)).toBe("indented");
    expect(codeFence("abc", 10)).toBe("indented");
  });
});

describe("findCodeBlocks", () => {
  it("returns blocks in document order with ranges and values", () => {
    const text = "```bash\nls\n```\n\nText.\n\n~~~\nx\n~~~\n";
    const doc = prepared(text);
    const blocks = findCodeBlocks(doc);
    expect(blocks.map((b) => [b.fence, b.lang, b.value])).toEqual([
      ["backticks", "bash", "ls"],
      ["tildes", undefined, "x"],
    ]);
    expect(blocks.map((b) => text.slice(b.range.start, b.range.end))).toEqual([
      "```bash\nls\n```",
      "~~~\nx\n~~~",
    ]);
  });

  it("finds indented blocks and blocks in lists and quotes", () => {
    const doc = prepared(
      "Text\n\n    code\n\n1. Step\n\n   ```bash\n   ls\n   ```\n\n> ~~~yaml\n> a: 1\n> ~~~\n",
    );
    expect(findCodeBlocks(doc).map((b) => b.fence)).toEqual([
      "indented",
      "backticks",
      "tildes",
    ]);
  });

  it("turns an empty or missing lang into undefined and keeps case", () => {
    const doc = prepared('```\nx\n```\n\n```Bash title="x"\ny\n```\n');
    expect(findCodeBlocks(doc).map((b) => b.lang)).toEqual([undefined, "Bash"]);
  });

  it("caches per doc", () => {
    const doc = prepared("```sh\nls\n```\n");
    expect(findCodeBlocks(doc)).toBe(findCodeBlocks(doc));
    expect(findCodeBlocks({ ...doc })).not.toBe(findCodeBlocks(doc));
  });

  it("drops ignored blocks", () => {
    const doc = prepared(
      "<!-- tulis-ignore -->\n```bash\nls\n```\n\nText.\n\n```sh\nx\n```\n",
    );
    expect(findCodeBlocks(doc).map((b) => b.lang)).toEqual(["sh"]);
  });

  it("skips blocks inside MDX JSX", () => {
    const doc = prepared(
      "<Tabs>\n\n```bash\nls\n```\n\n</Tabs>\n\n```sh\nx\n```\n",
      "mdx",
    );
    expect(findCodeBlocks(doc).map((b) => b.lang)).toEqual(["sh"]);
  });

  it("ignores Hugo highlight blocks and inline code", () => {
    const doc = prepared(
      "Use `ls`.\n\n{{< highlight go >}}\nx\n{{< /highlight >}}\n",
    );
    expect(findCodeBlocks(doc)).toEqual([]);
  });
});
