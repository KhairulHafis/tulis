import { describe, expect, it } from "vitest";
import { prepareDoc } from "../prepare/prepare-doc.js";
import { findHeadingSkip } from "./heading-skip.js";

function skip(text: string): ReturnType<typeof findHeadingSkip> {
  const doc = prepareDoc(text, "markdown");
  if (doc.kind !== "prepared") {
    throw new Error("skipped");
  }
  return findHeadingSkip(doc);
}

describe("findHeadingSkip", () => {
  it("reports a jump on the heading that skips a level", () => {
    expect(skip("# T\n\n## A\n\n#### B\n")?.value).toBe("jump");
  });

  it("reports none when levels step by one", () => {
    expect(skip("# T\n\n## A\n\n### B\n\n## C\n")?.value).toBe("none");
  });

  it("returns undefined when nothing was checked", () => {
    expect(skip("# T\n\nText.\n")).toBeUndefined();
    expect(skip("## A\n")).toBeUndefined();
  });

  it("treats a frontmatter title as level 1", () => {
    expect(skip("---\ntitle: T\n---\n\n### A\n")?.value).toBe("jump");
  });
});
