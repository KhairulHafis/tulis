import { describe, expect, it } from "vitest";
import { prepareDoc, type PreparedDoc } from "../prepare/prepare-doc.js";
import { findProcedures } from "./procedure-lists.js";

function prepared(text: string, syntax: "markdown" | "mdx" = "markdown") {
  const doc = prepareDoc(text, syntax);
  if (doc.kind !== "prepared") {
    throw new Error("not prepared");
  }
  return doc;
}

function find(text: string, syntax: "markdown" | "mdx" = "markdown") {
  return findProcedures(prepared(text, syntax));
}

describe("findProcedures", () => {
  it("finds a command list with numbers, blocks and starts", () => {
    const [procedure, ...rest] = find(
      "1. Install the agent.\n2. Select **Save**.\n",
    );
    expect(rest).toHaveLength(0);
    expect(procedure?.steps.map((s) => s.number)).toEqual([1, 2]);
    expect(procedure?.steps.map((s) => s.start)).toEqual([
      "imperative",
      "imperative",
    ]);
    expect(procedure?.steps.every((s) => s.block?.kind === "paragraph")).toBe(
      true,
    );
    expect(procedure?.steps[0]?.firstSentence).toBe(
      procedure?.steps[0]?.block?.sentences[0],
    );
    expect(procedure?.nested).toBe(false);
    expect(procedure?.range).toEqual({ start: 0, end: 41 });
  });

  it("drops a descriptive list", () => {
    expect(
      find("1. The client sends a request.\n2. The API server checks it.\n"),
    ).toHaveLength(0);
  });

  it("keeps a list with 2 of 3 command steps", () => {
    expect(
      find("1. Install it.\n2. Run it.\n3. The agent starts.\n"),
    ).toHaveLength(1);
  });

  it("drops a list with 1 of 3 command steps", () => {
    expect(
      find("1. Install it.\n2. The agent starts.\n3. The server checks it.\n"),
    ).toHaveLength(0);
  });

  it("keeps a list with exactly half", () => {
    expect(find("1. Install it.\n2. The agent starts.\n")).toHaveLength(1);
  });

  it("gives a step that starts with code no block and no judgement", () => {
    const [procedure] = find(
      "1. Install it.\n2. ```sh\n   make\n   ```\n3. The agent starts.\n",
    );
    const code = procedure?.steps[1];
    expect(code?.block).toBeUndefined();
    expect(code?.start).toBeUndefined();
    expect(code?.number).toBe(2);
  });

  it("does not count a code step toward the half", () => {
    expect(find("1. Install it.\n2. ```sh\n   make\n   ```\n")).toHaveLength(1);
    expect(
      find("1. ```sh\n   make\n   ```\n2. ```sh\n   x\n   ```\n"),
    ).toHaveLength(0);
  });

  it("ignores a bullet list", () => {
    expect(find("- Install it.\n- Run it.\n")).toHaveLength(0);
  });

  it("finds nested ordered lists with nested true and no before", () => {
    const procedures = find(
      "Intro:\n\n1. Open it.\n   1. Select **A**.\n   2. Select **B**.\n2. Close it.\n\n- Item\n  1. Run it.\n  2. Stop it.\n",
    );
    expect(procedures.map((p) => p.nested)).toEqual([false, true, true]);
    expect(procedures[0]?.before?.kind).toBe("paragraph");
    expect(procedures[1]?.before).toBeUndefined();
    expect(procedures[2]?.before).toBeUndefined();
  });

  it("finds before as a heading or a paragraph", () => {
    const [a, b] = find(
      "## Install\n\n1. Run it.\n2. Stop it.\n\nThen:\n\n1. Run it.\n2. Stop it.\n",
    );
    expect(a?.before?.kind).toBe("heading");
    expect(b?.before?.sentences[0]?.text).toBe("Then:");
  });

  it("has no before at the start of the doc or after a code block", () => {
    const [a] = find("1. Run it.\n2. Stop it.\n");
    expect(a?.before).toBeUndefined();
    const [b] = find("```sh\nmake\n```\n\n1. Run it.\n2. Stop it.\n");
    expect(b?.before).toBeUndefined();
  });

  it("skips lists inside an MDX JSX element", () => {
    expect(
      find("<Tabs>\n\n1. Open it.\n2. Close it.\n\n</Tabs>\n", "mdx"),
    ).toHaveLength(0);
    expect(find("1. Open it.\n2. Close it.\n", "mdx")).toHaveLength(1);
  });

  it("finds lists in quotes and directives", () => {
    expect(find("> 1. Open it.\n> 2. Close it.\n")).toHaveLength(1);
    expect(find(":::note\n1. Open it.\n2. Close it.\n:::\n")).toHaveLength(1);
  });

  it("reads parenthesis markers", () => {
    const [procedure] = find("1) Open it.\n2) Close it.\n");
    expect(procedure?.steps.map((s) => s.number)).toEqual([1, 2]);
  });

  it("returns procedures in document order", () => {
    const procedures = find(
      "1. Open it.\n   1. Run it.\n   2. Stop it.\n2. Close it.\n\nText.\n\n1. Run it.\n2. Stop it.\n",
    );
    const starts = procedures.map((p) => p.range.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(procedures).toHaveLength(3);
  });

  it("caches per doc", () => {
    const doc = prepared("1. Open it.\n2. Close it.\n");
    expect(findProcedures(doc)).toBe(findProcedures(doc));
  });

  it("gives equal results for a structured clone", () => {
    const doc: PreparedDoc = prepared(
      "## Go\n\n1. Open it.\n   1. Run it.\n   2. Stop it.\n2. Close it.\n",
    );
    const clone = structuredClone(doc);
    expect(findProcedures(clone)).toEqual(findProcedures(doc));
  });
});
