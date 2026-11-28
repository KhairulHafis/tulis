import { describe, expect, it } from "vitest";
import { prepareDoc, type PreparedDoc } from "../prepare/prepare-doc.js";
import { findIntro } from "./intro.js";

function build(text: string): PreparedDoc {
  const doc = prepareDoc(text, "markdown");
  if (doc.kind !== "prepared") {
    throw new Error("skipped");
  }
  return doc;
}

/** Template-only paragraphs `{{< x >}}` each separated by a blank line. */
function fillers(count: number): string {
  return "{{< x >}}\n\n".repeat(count);
}

describe("findIntro look-ahead", () => {
  it("pairs a closing tag 50 nodes after the opening tag", () => {
    // Opening, 49 single-tag fillers (named x), closing at node 50 after it.
    const doc = build(
      "# T\n\n{{< d >}}\n\n" + fillers(49) + "{{< /d >}}\n\nIntro.\n",
    );
    expect(findIntro(doc)?.value).toBe("yes");
  });

  it("does not pair a closing tag 51 nodes after the opening tag", () => {
    // The text after the closing tag is a list, so only a paired skip gives "no"
    // for the list; unpaired the fillers are skipped and the closing tag too.
    const text =
      "# T\n\n{{< d >}}\n\n" +
      "- item\n\n" +
      fillers(49) +
      "{{< /d >}}\n\nIntro.\n";
    const doc = build(text);
    const found = findIntro(doc);
    expect(found?.value).toBe("no");
    expect(doc.parsed.source.slice(found?.range.start, found?.range.end)).toBe(
      "- item",
    );
    const paired = build(
      "# T\n\n{{< d >}}\n\n" +
        "- item\n\n" +
        fillers(48) +
        "{{< /d >}}\n\nIntro.\n",
    );
    expect(findIntro(paired)?.value).toBe("yes");
  });

  it("skips an unpaired self-closing tag only", () => {
    const doc = build("# T\n\n{{< d />}}\n\n- item\n\n{{< /d >}}\n\nIntro.\n");
    expect(findIntro(doc)?.value).toBe("no");
  });
});

describe("findIntro note boxes", () => {
  it("does not skip a list that holds a note box", () => {
    const doc = build("# T\n\n- item\n\n  > [!NOTE]\n  > Careful.\n\nText.\n");
    const found = findIntro(doc);
    expect(found?.value).toBe("no");
    expect(doc.parsed.source.slice(found?.range.start, found?.range.end)).toBe(
      "- item\n\n  > [!NOTE]\n  > Careful.",
    );
  });
});
