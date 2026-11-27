import { describe, expect, it } from "vitest";
import type { Scalar } from "yaml";
import {
  YamlParseError,
  parseYaml,
  parseYamlDocument,
  serializeYamlDocument,
} from "./parse-yaml.js";
import type { SerializeYamlOptions } from "./parse-yaml.js";

function errorOf(text: string, options?: Parameters<typeof parseYaml>[1]) {
  try {
    parseYaml(text, options);
  } catch (error) {
    if (error instanceof YamlParseError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected parseYaml to throw");
}

describe("parseYaml values", () => {
  it("reads maps, lists and nested data", () => {
    const result = parseYaml(
      "name: tulis\nitems:\n  - a\n  - b\nnested:\n  deep:\n    x: 1\n",
    );
    expect(result.value).toEqual({
      name: "tulis",
      items: ["a", "b"],
      nested: { deep: { x: 1 } },
    });
  });

  it("reads strings, numbers, booleans and null", () => {
    const result = parseYaml(
      "s: hello\nq: 'quoted'\ni: 42\nf: 1.5\nt: true\nn: null\ne:\n",
    );
    expect(result.value).toEqual({
      s: "hello",
      q: "quoted",
      i: 42,
      f: 1.5,
      t: true,
      n: null,
      e: null,
    });
  });

  it("keeps yes, on and no as strings (YAML 1.2)", () => {
    const result = parseYaml("a: yes\nb: on\nc: no\n");
    expect(result.value).toEqual({ a: "yes", b: "on", c: "no" });
  });

  it("keeps dates as strings", () => {
    expect(parseYaml("d: 2026-01-01\n").value).toEqual({ d: "2026-01-01" });
  });

  it("gives null for an empty file", () => {
    expect(parseYaml("").value).toBeNull();
  });

  it("gives null for a comments-only file", () => {
    expect(parseYaml("# nothing here\n# at all\n").value).toBeNull();
  });

  it("accepts standard explicit tags", () => {
    expect(parseYaml("a: !!str 5\nb: !!int 7\n").value).toEqual({
      a: "5",
      b: 7,
    });
  });

  it("allows aliases within the limit", () => {
    expect(parseYaml("a: &x 1\nb: *x\n").value).toEqual({ a: 1, b: 1 });
  });
});

describe("parseYaml lineOf", () => {
  const text = [
    "# comment", // 1
    "threshold: 5", // 2
    "nested:", // 3
    "  inner: yes", // 4
    "list:", // 5
    "  - one", // 6
    "  - name: two", // 7
    "    size: 3", // 8
    "",
  ].join("\n");
  const { lineOf } = parseYaml(text);

  it("finds a top-level key", () => {
    expect(lineOf(["threshold"])).toBe(2);
  });

  it("finds a nested key", () => {
    expect(lineOf(["nested", "inner"])).toBe(4);
  });

  it("finds a list item", () => {
    expect(lineOf(["list", 0])).toBe(6);
    expect(lineOf(["list", 1])).toBe(7);
  });

  it("finds a key inside a list item", () => {
    expect(lineOf(["list", 1, "size"])).toBe(8);
  });

  it("returns undefined for a missing key", () => {
    expect(lineOf(["nope"])).toBeUndefined();
    expect(lineOf(["nested", "nope"])).toBeUndefined();
  });

  it("returns undefined for an out-of-range index", () => {
    expect(lineOf(["list", 2])).toBeUndefined();
    expect(lineOf(["list", -1])).toBeUndefined();
  });

  it("returns undefined for a path through a scalar", () => {
    expect(lineOf(["threshold", "x"])).toBeUndefined();
    expect(lineOf(["list", 0, "x"])).toBeUndefined();
  });

  it("returns undefined when the segment type does not fit", () => {
    expect(lineOf(["list", "0"])).toBeUndefined();
    expect(lineOf(["threshold", 0])).toBeUndefined();
  });

  it("gives the start of the top-level value for an empty path", () => {
    expect(lineOf([])).toBe(2);
  });

  it("gives undefined for an empty path in an empty file", () => {
    expect(parseYaml("").lineOf([])).toBeUndefined();
    expect(parseYaml("# c\n").lineOf(["a"])).toBeUndefined();
  });
});

describe("parseYaml errors", () => {
  it("reports a syntax error with its line", () => {
    const error = errorOf("a: 1\nb: [1, 2\nc: 3\n");
    expect(error).toBeInstanceOf(YamlParseError);
    expect(error.line).toBeGreaterThanOrEqual(2);
    expect(error.message).toContain(`line ${String(error.line)}`);
    expect(error.reason).not.toBe("");
    expect(error.reason).not.toContain("line");
    expect(error.message.endsWith(error.reason)).toBe(true);
  });

  it("reports the line of a bad indent", () => {
    const error = errorOf("a:\n  b: 1\n c: 2\n");
    expect(error.line).toBe(3);
  });

  it("refuses an unknown alias", () => {
    expect(errorOf("a: *missing\n").message).toContain("alias");
  });

  it("refuses recursive aliases", () => {
    expect(() => parseYaml("&a [*a]\n")).toThrow(YamlParseError);
  });

  it("refuses a %YAML 1.1 directive", () => {
    expect(() => parseYaml("%YAML 1.1\n---\na: yes\n")).toThrow(YamlParseError);
  });
});

describe("parseYaml option validation", () => {
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects maxBytes %s",
    (value) => {
      expect(() => parseYaml("a: 1", { maxBytes: value })).toThrow(/maxBytes/);
    },
  );

  it.each([0, -1, 2.5])("rejects maxDepth %s", (value) => {
    expect(() => parseYaml("a: 1", { maxDepth: value })).toThrow(/maxDepth/);
  });

  it.each([-1, 1.5, Number.NaN])("rejects maxAliases %s", (value) => {
    expect(() => parseYaml("a: 1", { maxAliases: value })).toThrow(
      /maxAliases/,
    );
  });

  it("accepts maxAliases 0", () => {
    expect(parseYaml("a: 1", { maxAliases: 0 }).value).toEqual({ a: 1 });
  });

  it("throws a plain Error, not YamlParseError", () => {
    try {
      parseYaml("a: 1", { maxBytes: 0 });
    } catch (error) {
      expect(error).not.toBeInstanceOf(YamlParseError);
    }
  });
});

describe("parseYamlDocument", () => {
  const text = "a: 1\nlist:\n  - x\n  - y: 2\n";

  it("gives the same value and lines as parseYaml", () => {
    const plain = parseYaml(text);
    const doc = parseYamlDocument(text);
    expect(doc.value).toEqual(plain.value);
    for (const path of [
      ["a"],
      ["list"],
      ["list", 1],
      ["list", 1, "y"],
      ["z"],
    ]) {
      expect(doc.lineOf(path)).toBe(plain.lineOf(path));
    }
  });

  it("detects the line ending from the first line break", () => {
    expect(parseYamlDocument("a: 1\r\nb: 2\r\n").lineEnding).toBe("\r\n");
    expect(parseYamlDocument("a: 1\nb: 2\n").lineEnding).toBe("\n");
    expect(parseYamlDocument("a: 1").lineEnding).toBe("\n");
    expect(parseYamlDocument("\n").lineEnding).toBe("\n");
  });

  it("detects a byte order mark", () => {
    expect(parseYamlDocument("﻿a: 1\n").hasBom).toBe(true);
    expect(parseYamlDocument("﻿a: 1\n").value).toEqual({ a: 1 });
    expect(parseYamlDocument("a: 1\n").hasBom).toBe(false);
  });
});

const REALISTIC = `# Tulis team settings
version: 1

prodBranch: main # the release branch
include: ["docs/**", "*.md"]
docTypes:
  frontmatterKey: type
  rules:
    - type: 'Guide' # how-to pages
      include: ["docs/guides/**"]
    # a comment between items
    - type: "API"
      include: ['docs/api/**', "docs/ref/**"]

# something Tulis does not know
custom:
  nested:
    key: value # note
    other: 'it''s fine'
longText: this is a long plain string that goes well past eighty columns on purpose, to check folding

# end of file
`;

function roundTrip(text: string, options?: SerializeYamlOptions): string {
  return serializeYamlDocument(parseYamlDocument(text).document, options);
}

describe("serializeYamlDocument", () => {
  it("gives back an unedited realistic file byte for byte", () => {
    expect(roundTrip(REALISTIC)).toBe(REALISTIC);
  });

  it("keeps everything untouched when adding an item and changing a scalar", () => {
    const parsed = parseYamlDocument(REALISTIC);
    const doc = parsed.document;
    doc.addIn(["docTypes", "rules"], { type: "Note", include: ["docs/n/**"] });
    doc.setIn(["prodBranch"], "release");
    const expected = REALISTIC.replace(
      "prodBranch: main # the release branch",
      "prodBranch: release # the release branch",
    ).replace(
      "\n# something Tulis",
      "    - type: Note\n      include:\n        - docs/n/**\n\n# something Tulis",
    );
    expect(serializeYamlDocument(doc)).toBe(expected);
  });

  it("keeps CRLF", () => {
    const crlf = REALISTIC.replaceAll("\n", "\r\n");
    const parsed = parseYamlDocument(crlf);
    expect(parsed.lineEnding).toBe("\r\n");
    expect(
      serializeYamlDocument(parsed.document, { lineEnding: parsed.lineEnding }),
    ).toBe(crlf);
  });

  it("writes LF by default", () => {
    expect(roundTrip("a: 1\nb: 2\n")).toBe("a: 1\nb: 2\n");
  });

  it("writes the byte order mark only when asked", () => {
    const text = "﻿a: 1\n";
    const parsed = parseYamlDocument(text);
    expect(parsed.hasBom).toBe(true);
    expect(serializeYamlDocument(parsed.document, { bom: true })).toBe(text);
    expect(serializeYamlDocument(parsed.document)).toBe("a: 1\n");
  });

  it("refuses text that grows past maxBytes", () => {
    const doc = parseYamlDocument("a: 1\n", { maxBytes: 20 }).document;
    doc.setIn(["a"], "x".repeat(50));
    expect(() => serializeYamlDocument(doc, { maxBytes: 20 })).toThrow(
      YamlParseError,
    );
  });

  it("counts CRLF and the byte order mark toward maxBytes", () => {
    const doc = parseYamlDocument("a: 1\nb: 2\n").document;
    expect(serializeYamlDocument(doc, { maxBytes: 10 })).toBe("a: 1\nb: 2\n");
    expect(() =>
      serializeYamlDocument(doc, { maxBytes: 10, lineEnding: "\r\n" }),
    ).toThrow(YamlParseError);
  });

  it("refuses an edit that adds a non-string key", () => {
    const doc = parseYamlDocument("a: 1\n").document;
    doc.setIn([2], "x");
    expect(() => serializeYamlDocument(doc)).toThrow(YamlParseError);
  });

  it("refuses an edit that adds too many aliases", () => {
    const doc = parseYamlDocument("base: &b 1\n").document;
    for (let i = 0; i < 12; i++) {
      doc.setIn(
        [`k${String(i)}`],
        doc.createAlias(doc.getIn(["base"], true) as Scalar, `a${String(i)}`),
      );
    }
    expect(() => serializeYamlDocument(doc)).toThrow(YamlParseError);
  });
});

describe("list indentation", () => {
  const UNINDENTED =
    "# groups\nversion: 1\ngroups:\n- id: a # first\n  kind: synonym\n- id: b\n  kind: synonym\nother: 1\n";
  const INDENTED =
    "version: 1\ngroups:\n  - id: a # first\n    kind: synonym\n  - id: b\n";

  function roundTripWithDetected(text: string): string {
    const parsed = parseYamlDocument(text);
    return serializeYamlDocument(parsed.document, {
      indentSeq: parsed.indentSeq,
      lineEnding: parsed.lineEnding,
    });
  }

  it("detects an unindented list and round-trips it", () => {
    expect(parseYamlDocument(UNINDENTED).indentSeq).toBe(false);
    expect(roundTripWithDetected(UNINDENTED)).toBe(UNINDENTED);
  });

  it("detects an indented list and round-trips it", () => {
    expect(parseYamlDocument(INDENTED).indentSeq).toBe(true);
    expect(roundTripWithDetected(INDENTED)).toBe(INDENTED);
  });

  it("reports true for flow lists, top-level lists and no lists", () => {
    expect(parseYamlDocument("a: [x, y]\n").indentSeq).toBe(true);
    expect(parseYamlDocument("- a\n- b\n").indentSeq).toBe(true);
    expect(parseYamlDocument("a: 1\n").indentSeq).toBe(true);
    expect(parseYamlDocument("").indentSeq).toBe(true);
  });

  it("uses the first list in document order", () => {
    const text = "a:\n  b:\n  - x\nc:\n  - y\n";
    expect(parseYamlDocument(text).indentSeq).toBe(false);
  });

  it("keeps a new item unindented", () => {
    const parsed = parseYamlDocument(UNINDENTED);
    parsed.document.addIn(["groups"], { id: "c", kind: "synonym" });
    expect(
      serializeYamlDocument(parsed.document, { indentSeq: parsed.indentSeq }),
    ).toBe(
      UNINDENTED.replace("other: 1", "- id: c\n  kind: synonym\nother: 1"),
    );
  });

  it("round-trips an unindented CRLF file", () => {
    const crlf = UNINDENTED.replaceAll("\n", "\r\n");
    expect(roundTripWithDetected(crlf)).toBe(crlf);
  });
});
