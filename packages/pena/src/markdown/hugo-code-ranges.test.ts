import { describe, expect, it } from "vitest";
import { findHugoCodeRanges } from "./hugo-code-ranges.js";

function slices(source: string): string[] {
  return findHugoCodeRanges(source).map((r) => source.slice(r.start, r.end));
}

describe("findHugoCodeRanges", () => {
  it("covers opening line through closing tag", () => {
    const src = 'a\n{{< highlight yaml "x" >}}\n# c\n{{< /highlight >}}\nb\n';
    expect(slices(src)).toEqual([
      '{{< highlight yaml "x" >}}\n# c\n{{< /highlight >}}',
    ]);
  });

  it("accepts no spaces, percent delimiters, indent and CRLF", () => {
    expect(slices("{{<highlight y>}}\nx\n{{</highlight>}}")).toHaveLength(1);
    expect(slices("{{% highlight b %}}\nx\n{{% /highlight %}}")).toHaveLength(
      1,
    );
    expect(
      slices("   {{< highlight >}}\r\nx\r\n{{< /highlight >}}\r\n"),
    ).toEqual(["   {{< highlight >}}\r\nx\r\n{{< /highlight >}}"]);
  });

  it("ignores unclosed, mid-line, deep-indent and other names", () => {
    expect(slices("{{< highlight y >}}\nx\n")).toEqual([]);
    expect(slices("see {{< highlight >}} here\n{{< /highlight >}}")).toEqual(
      [],
    );
    expect(slices("    {{< highlight >}}\nx\n{{< /highlight >}}")).toEqual([]);
    expect(slices("{{< highlights >}}\nx\n{{< /highlights >}}")).toEqual([]);
    expect(slices("{{< /highlight >}}\n")).toEqual([]);
  });

  it("does not nest: the first closing tag ends the pair", () => {
    const src =
      "{{< highlight >}}\n{{< highlight >}}\nx\n{{< /highlight >}}\ny\n{{< /highlight >}}";
    expect(slices(src)).toEqual([
      "{{< highlight >}}\n{{< highlight >}}\nx\n{{< /highlight >}}",
    ]);
  });
});
