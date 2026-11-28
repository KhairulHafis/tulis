import { describe, expect, it } from "vitest";
import type { MarkdownSyntax } from "../markdown/parse-markdown.js";
import { prepareDoc, type PreparedDoc } from "../prepare/prepare-doc.js";
import { findAdmonitions } from "./find-admonitions.js";

function prepared(
  text: string,
  syntax: MarkdownSyntax = "markdown",
): PreparedDoc {
  const result = prepareDoc(text, syntax);
  if (result.kind !== "prepared") {
    throw new Error("skipped: " + result.reason);
  }
  return result;
}

function found(text: string, syntax: MarkdownSyntax = "markdown") {
  const doc = prepared(text, syntax);
  return findAdmonitions(doc).map((a) => ({
    syntax: a.syntax,
    kind: a.kind,
    text: doc.parsed.source.slice(a.range.start, a.range.end),
    label:
      a.label === undefined
        ? undefined
        : doc.parsed.source.slice(a.label.range.start, a.label.range.end),
  }));
}

describe("blockquote-label (4b)", () => {
  it("records kind, range and label range", () => {
    expect(found("> **Note:** Body\n\nAfter.")).toEqual([
      {
        syntax: "blockquote-label",
        kind: "note",
        text: "> **Note:** Body",
        label: "**Note:**",
      },
    ]);
  });

  it("needs a single plain text child inside the strong", () => {
    expect(found("> **Note here:** Body")).toEqual([]);
    expect(found("> **_Note_:** Body")).toEqual([]);
  });

  it("does not count a label that is not the first child", () => {
    expect(found("> Text **Note:** Body")).toEqual([]);
  });
});

describe("github-alert (4a)", () => {
  it("records offsets and keeps the kind in lower case", () => {
    const doc = prepared("> [!WARNING]\n> Body");
    const [alert] = findAdmonitions(doc);
    expect(alert?.syntax).toBe("github-alert");
    expect(alert?.kind).toBe("warning");
    expect(alert?.range).toEqual({ start: 0, end: 19 });
    expect(alert?.label).toBeUndefined();
  });

  it("takes 1 to 20 letters only", () => {
    expect(found("> [!a]\n> B")).toHaveLength(1);
    expect(found("> [!" + "a".repeat(20) + "]\n> B")).toHaveLength(1);
    expect(found("> [!" + "a".repeat(21) + "]\n> B")).toEqual([]);
    expect(found("> [!]\n> B")).toEqual([]);
    expect(found("> [!a1]\n> B")).toEqual([]);
  });

  it("accepts the end of the paragraph, a space or a tab after the bracket", () => {
    expect(found("> [!NOTE]")).toHaveLength(1);
    expect(found("> [!NOTE]\tBody")).toHaveLength(1);
    expect(found("> [!NOTE]x")).toEqual([]);
  });

  it("works with CRLF line endings", () => {
    expect(found("> [!NOTE]\r\n> Body\r\n")).toHaveLength(1);
  });

  it("wins over a bold label inside it", () => {
    expect(found("> [!NOTE]\n> **Note:** Body").map((a) => a.syntax)).toEqual([
      "github-alert",
    ]);
  });
});

describe("directive (5, 6a)", () => {
  it("records a container directive by name, ignoring case", () => {
    const doc = prepared(":::Warning\n\nBody\n\n:::");
    expect(findAdmonitions(doc).map((a) => [a.syntax, a.kind])).toEqual([
      ["directive", "warning"],
    ]);
    expect(found(":::details\n\nBody\n\n:::")).toEqual([]);
  });

  it("keeps walking into an unknown directive", () => {
    expect(found(":::details\n\n**Note:** Body\n\n:::")).toHaveLength(1);
  });

  it("reads the older form from the paragraph source", () => {
    expect(found(":::tip My title\n\nBody\n\n:::")).toEqual([
      {
        syntax: "directive",
        kind: "tip",
        text: ":::tip My title",
        label: undefined,
      },
    ]);
    expect(found(":::tipx y\n\nBody")).toEqual([]);
    expect(found(":::TIP y\n\nBody")).toEqual([]);
  });

  it("reads the older form with CRLF", () => {
    expect(found(":::note x\r\n\r\nBody\r\n")).toHaveLength(1);
  });
});

describe("paragraph-label (6b)", () => {
  it("records a label in a paragraph, with its range", () => {
    expect(found("Intro.\n\n**IMPORTANT:** Body")).toEqual([
      {
        syntax: "paragraph-label",
        kind: "important",
        text: "**IMPORTANT:** Body",
        label: "**IMPORTANT:**",
      },
    ]);
  });

  it("gives no format but still counts for a lower case label", () => {
    const doc = prepared("**note:** Body");
    const [one] = findAdmonitions(doc);
    expect(one?.syntax).toBe("paragraph-label");
    expect(one?.label?.format).toBeUndefined();
  });
});

describe("hugo-shortcode (6c)", () => {
  it("records the tag range only", () => {
    expect(found("{{< note >}}\nBody text.\n{{< /note >}}")).toEqual([
      {
        syntax: "hugo-shortcode",
        kind: "note",
        text: "{{< note >}}",
        label: undefined,
      },
    ]);
  });

  it("finds several tags in one paragraph, in order, with a quote prefix", () => {
    expect(
      found("{{< tip >}}\n> {{% Warning %}}\n{{< /tip >}}").map((a) => [
        a.kind,
        a.text,
      ]),
    ).toEqual([
      ["tip", "{{< tip >}}"],
      ["warning", "{{% Warning %}}"],
    ]);
  });

  it("is off for mdx and for names outside the list", () => {
    expect(found("{{< highlight >}}\nx")).toEqual([]);
    expect(found("{{< notes >}}\nx")).toEqual([]);
    expect(found("{{< note")).toEqual([]);
    expect(found("{{< note >}\nx")).toEqual([]);
  });

  it("needs the end marker to match the opener", () => {
    expect(found("{{< note %}}")).toEqual([]);
    expect(found("{{% note >}}")).toEqual([]);
  });

  it("limits the tag to 1,000 characters", () => {
    const head = '{{< note title="';
    const tail = '" >}}';
    const exact = head + "a".repeat(1000 - head.length - tail.length) + tail;
    expect(exact).toHaveLength(1000);
    expect(found(exact)).toHaveLength(1);
    expect(
      found(head + "a".repeat(1001 - head.length - tail.length) + tail),
    ).toEqual([]);
  });

  it("works with CRLF line endings", () => {
    const doc = prepared("Intro.\r\n{{< note >}}\r\nBody\r\n{{< /note >}}\r\n");
    const [tag] = findAdmonitions(doc);
    expect(doc.parsed.source.slice(tag?.range.start, tag?.range.end)).toBe(
      "{{< note >}}",
    );
  });

  it("does not match inside a label or older directive paragraph", () => {
    expect(found("**Note:** {{< tip >}}").map((a) => a.syntax)).toEqual([
      "paragraph-label",
    ]);
  });
});

describe("skipping, order, ignore and cache", () => {
  it("does not count anything nested in an admonition", () => {
    expect(found("> **Note:** A\n>\n> **Tip:** B")).toHaveLength(1);
    expect(found(":::note\n\n{{< tip >}}\n\n:::")).toHaveLength(1);
  });

  it("drops an ignored admonition and its children", () => {
    expect(found("<!-- tulis-ignore -->\n> **Note:** A\n\nText.")).toEqual([]);
    expect(
      found("<!-- tulis-ignore -->\n:::note\n\n**Tip:** A\n\n:::\n\nB."),
    ).toEqual([]);
  });

  it("keeps document order across syntaxes", () => {
    expect(
      found("**Tip:** A\n\n> [!NOTE]\n> B\n\n{{< warning >}}\nC").map(
        (a) => a.syntax,
      ),
    ).toEqual(["paragraph-label", "github-alert", "hugo-shortcode"]);
  });

  it("returns the same array for the same doc", () => {
    const doc = prepared("**Note:** A");
    expect(findAdmonitions(doc)).toBe(findAdmonitions(doc));
  });
});
