import { describe, expect, it } from "vitest";
import {
  findTemplateTags,
  MAX_TEMPLATE_TAG_LENGTH,
  type TemplateTagSyntax,
} from "./template-tags.js";

function texts(source: string): string[] {
  return findTemplateTags(source).map((t) => source.slice(t.start, t.end));
}

describe("findTemplateTags examples", () => {
  const examples: [string, TemplateTagSyntax][] = [
    ["{{< note >}}", "hugo"],
    ["{{< /note >}}", "hugo"],
    ["{{<note>}}", "hugo"],
    ['{{% tab name="Linux" %}}', "hugo"],
    ['{{< glossary_tooltip text="cluster" term_id="cluster" >}}', "hugo"],
    ["{{</* comment */>}}", "hugo"],
    ["{% include note.html %}", "liquid"],
    ["{%- if x -%}", "liquid"],
    ["{{ .Site.Title }}", "liquid"],
    ["{{- .Name -}}", "liquid"],
  ];
  for (const [tag, syntax] of examples) {
    it("finds " + tag, () => {
      const source = "Before " + tag + " after.";
      expect(findTemplateTags(source)).toEqual([
        { start: 7, end: 7 + tag.length, syntax },
      ]);
    });
  }
});

describe("findTemplateTags behaviour", () => {
  it("finds several tags in order", () => {
    const source = "a {{< x >}} b {% y %} c {{ z }}";
    expect(texts(source)).toEqual(["{{< x >}}", "{% y %}", "{{ z }}"]);
  });

  it("finds a tag across two lines", () => {
    const source = "a {{< x\n y >}} b";
    expect(texts(source)).toEqual(["{{< x\n y >}}"]);
  });

  it("stops at a blank line", () => {
    expect(texts("{{< x\n\ny >}}")).toEqual([]);
    expect(texts("{{< x\r\n\r\ny >}}")).toEqual([]);
    expect(texts("{{< x\n \t \ny >}}")).toEqual([]);
    expect(texts("{{< x\r\r y >}}")).toEqual([]);
    expect(texts("{{< x\r\n  \r\ny >}}")).toEqual([]);
  });

  it("treats a lone carriage return as a line ending", () => {
    expect(texts("{{< x\r \t\r y >}}")).toEqual([]);
    expect(texts("{{< x\r\n\r y >}}")).toEqual([]);
    expect(texts("{{< x\n\r\n y >}}")).toEqual([]);
    expect(texts("{{< x\r y >}}")).toEqual(["{{< x\r y >}}"]);
  });

  it("keeps tags on both sides of a blank line", () => {
    expect(texts("{{< a >}}\n\n{{< b >}}")).toEqual(["{{< a >}}", "{{< b >}}"]);
  });

  it("does not treat a single line break as blank", () => {
    expect(texts("{{< x\r\ny >}}")).toEqual(["{{< x\r\ny >}}"]);
  });

  it("finds a tag after a blank line", () => {
    expect(texts("a\n\n{{< x >}}")).toEqual(["{{< x >}}"]);
  });

  it("ignores lone delimiters", () => {
    for (const s of ["{", "{{", "}}", "%}", ">}}", "{{<", "{%", "a { b"]) {
      expect(texts(s)).toEqual([]);
    }
  });

  it("finds a later tag after an unclosed opener", () => {
    const source = "{{< open {{< x >}}";
    expect(findTemplateTags(source)).toEqual([
      { start: 0, end: source.length, syntax: "hugo" },
    ]);
    expect(texts("{{< a\n\n{{% b %}}")).toEqual(["{{% b %}}"]);
  });

  it("respects the length limit", () => {
    const fill = (n: number): string => "x".repeat(n);
    const exact = "{{<" + fill(MAX_TEMPLATE_TAG_LENGTH - 6) + ">}}";
    expect(exact).toHaveLength(MAX_TEMPLATE_TAG_LENGTH);
    expect(texts(exact)).toEqual([exact]);
    const tooLong = "{{<" + fill(MAX_TEMPLATE_TAG_LENGTH - 5) + ">}}";
    expect(texts(tooLong)).toEqual([]);
  });

  it("honours start and end", () => {
    const source = "{{< a >}} {{< b >}} {{< c >}}";
    expect(findTemplateTags(source, 10, 19)).toEqual([
      { start: 10, end: 19, syntax: "hugo" },
    ]);
    expect(findTemplateTags(source, 10, 18)).toEqual([]);
    expect(findTemplateTags(source, 1, 9)).toEqual([]);
    expect(findTemplateTags(source, -5, 9)).toHaveLength(1);
    expect(findTemplateTags(source, 20, 9999)).toHaveLength(1);
    expect(findTemplateTags(source, 20, 5)).toEqual([]);
  });

  it("clamps end before looking for a blank line or closer", () => {
    // The blank line and the closer both lie past end, so only the slice counts.
    expect(findTemplateTags("{{< a\n\nb >}}", 0, 5)).toEqual([]);
    expect(findTemplateTags("{{< a >}} {{< b >}}", 0, 12)).toHaveLength(1);
    expect(findTemplateTags("x {{< a >}}", 2, 11)).toEqual([
      { start: 2, end: 11, syntax: "hugo" },
    ]);
  });

  it("takes the nearest closer of the first opener that has one", () => {
    // }} appears inside a later closer; the {{< opener wins and runs to >}}.
    const source = "{{< a }} b >}}";
    expect(findTemplateTags(source)).toEqual([
      { start: 0, end: source.length, syntax: "hugo" },
    ]);
    // Over the length cap, the hugo match is rejected and the liquid one wins.
    const far = "{{< a }} " + "x".repeat(MAX_TEMPLATE_TAG_LENGTH) + " >}}";
    expect(findTemplateTags(far)[0]).toEqual({
      start: 0,
      end: 8,
      syntax: "liquid",
    });
  });

  it("applies the opener order", () => {
    expect(findTemplateTags("{{% x %}}")[0]?.syntax).toBe("hugo");
    expect(findTemplateTags("{{ x }}")[0]?.syntax).toBe("liquid");
    expect(findTemplateTags("{{< x >}}")[0]?.syntax).toBe("hugo");
    // No >}} closer, so {{< falls through to the liquid {{ ... }} rule.
    const mixed = findTemplateTags("{{< x %}}");
    expect(mixed).toEqual([{ start: 0, end: 9, syntax: "liquid" }]);
    expect(findTemplateTags("{% x %}")[0]?.syntax).toBe("liquid");
  });

  it("does not nest", () => {
    expect(texts("{{ a {{ b }} c }}")).toEqual(["{{ a {{ b }}"]);
  });
});
