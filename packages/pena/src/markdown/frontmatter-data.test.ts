import { describe, expect, it } from "vitest";
import {
  LANGUAGE_FIELDS,
  MAX_FRONTMATTER_FIELDS,
  MAX_FRONTMATTER_VALUE_LENGTH,
  frontmatterTitle,
  isNonEnglish,
  readFrontmatter,
  type FrontmatterData,
} from "./frontmatter-data.js";
import { parseMarkdown } from "./parse-markdown.js";

function read(text: string): FrontmatterData {
  const parsed = parseMarkdown(text, "markdown");
  if (parsed.kind !== "parsed" || parsed.frontmatter === undefined) {
    throw new Error("no frontmatter");
  }
  return readFrontmatter(parsed.frontmatter);
}

function yaml(body: string): FrontmatterData {
  return read("---\n" + body + "\n---\n\n# Hi\n");
}

function toml(body: string): FrontmatterData {
  return read("+++\n" + body + "\n+++\n\n# Hi\n");
}

function entries(data: FrontmatterData): [string, string][] {
  return [...data.fields];
}

describe("readFrontmatter with YAML", () => {
  it("keeps title, language and other strings in order", () => {
    const data = yaml("title: Hello\nlang: fr\nauthor: Sam");
    expect(data.format).toBe("yaml");
    expect(entries(data)).toEqual([
      ["title", "Hello"],
      ["lang", "fr"],
      ["author", "Sam"],
    ]);
    expect(data.warnings).toEqual([]);
  });

  it("keeps source order when a key looks like an integer", () => {
    const data = yaml('title: Hello\n"1": one\nauthor: Sam\n"0": zero');
    expect(entries(data).map(([key]) => key)).toEqual([
      "title",
      "1",
      "author",
      "0",
    ]);
  });

  it("skips non-string values silently", () => {
    const data = yaml("a: 1\nb: true\nc: [x, y]\nd: {e: f}\ng:\nh: text");
    expect(entries(data)).toEqual([["h", "text"]]);
    expect(data.warnings).toEqual([]);
  });

  it("gives nothing for empty and comments-only YAML", () => {
    for (const body of ["", "# just a comment"]) {
      const data = yaml(body);
      expect(data.fields.size).toBe(0);
      expect(data.warnings).toEqual([]);
    }
  });

  it("warns not-a-map for a list and a scalar", () => {
    expect(yaml("- a\n- b").warnings).toEqual([{ code: "not-a-map", line: 1 }]);
    expect(yaml("just text").warnings).toEqual([
      { code: "not-a-map", line: 1 },
    ]);
  });

  it("warns invalid-yaml with the doc line", () => {
    const data = yaml("title: ok\nkey: a\nkey: b");
    expect(data.fields.size).toBe(0);
    expect(data.warnings).toEqual([{ code: "invalid-yaml", line: 4 }]);
  });

  it("warns value-too-long on the key line and drops the field", () => {
    const long = "x".repeat(MAX_FRONTMATTER_VALUE_LENGTH + 1);
    const data = yaml("title: ok\nbig: " + long + "\nlang: de");
    expect(entries(data)).toEqual([
      ["title", "ok"],
      ["lang", "de"],
    ]);
    expect(data.warnings).toEqual([{ code: "value-too-long", line: 3 }]);
  });

  it("keeps a value of exactly the maximum length", () => {
    const data = yaml("a: " + "x".repeat(MAX_FRONTMATTER_VALUE_LENGTH));
    expect(data.fields.size).toBe(1);
    expect(data.warnings).toEqual([]);
  });

  it("warns once for too many fields, at the first dropped key", () => {
    const lines: string[] = [];
    for (let i = 0; i < MAX_FRONTMATTER_FIELDS + 5; i += 1) {
      lines.push("k" + String(i) + ": v");
    }
    const data = yaml(lines.join("\n"));
    expect(data.fields.size).toBe(MAX_FRONTMATTER_FIELDS);
    expect(data.warnings).toEqual([
      { code: "too-many-fields", line: MAX_FRONTMATTER_FIELDS + 2 },
    ]);
  });
});

describe("readFrontmatter with TOML", () => {
  it("reads basic and literal strings and keys", () => {
    const data = toml(
      'title = "Hello"\nlang = \'fr\'\n"quoted key" = "v"\nbare-key_1 = \'x\'',
    );
    expect(data.format).toBe("toml");
    expect(entries(data)).toEqual([
      ["title", "Hello"],
      ["lang", "fr"],
      ["quoted key", "v"],
      ["bare-key_1", "x"],
    ]);
    expect(data.warnings).toEqual([]);
  });

  it("decodes escapes", () => {
    const data = toml(
      'a = "q\\"b\\\\ \\t\\n \\u00E9 \\U0001F600"\nb = \'no \\n escape\'',
    );
    expect(data.fields.get("a")).toBe('q"b\\ \t\n \u00e9 \u{1F600}');
    expect(data.fields.get("b")).toBe("no \\n escape");
  });

  it("ignores lines with invalid escapes or bad code points", () => {
    const data = toml(
      'a = "\\q"\nb = "\\uD800"\nc = "\\U00110000"\nd = "\\u12"\ne = "ok"',
    );
    expect(entries(data)).toEqual([["e", "ok"]]);
    expect(data.warnings).toEqual([]);
  });

  it("allows trailing comments and spaces, ignores trailing junk", () => {
    const data = toml(
      'a = "x" # note\nb = \'y\'   \nc = "z" extra\nd = "w"# c',
    );
    expect(entries(data)).toEqual([
      ["a", "x"],
      ["b", "y"],
      ["d", "w"],
    ]);
  });

  it("skips blank and comment lines", () => {
    const data = toml('# c\n\n   # indented\n  a = "x"');
    expect(entries(data)).toEqual([["a", "x"]]);
  });

  it("stops at the first table header", () => {
    const data = toml('title = "Top"\n[table]\nlang = "fr"');
    expect(entries(data)).toEqual([["title", "Top"]]);
  });

  it("does not read a fake title inside a multi-line string", () => {
    const data = toml(
      'desc = """\ntitle = "fake"\n"""\nlang = "de"\nnote = \'\'\'\ntitle = "fake2"\n\'\'\'',
    );
    expect(entries(data)).toEqual([["lang", "de"]]);
  });

  it("handles a multi-line string closed on its opening line", () => {
    const data = toml('a = """x"""\nb = "y"');
    expect(entries(data)).toEqual([["b", "y"]]);
  });

  it("ignores arrays, numbers, booleans, dates and inline tables", () => {
    const data = toml(
      'a = ["x"]\nb = 5\nc = true\nd = 2024-01-01\ne = { f = "g" }\nh = "ok"',
    );
    expect(entries(data)).toEqual([["h", "ok"]]);
    expect(data.warnings).toEqual([]);
  });

  it("ignores dotted keys and lines that match nothing", () => {
    const data = toml('a.b = "x"\nnonsense\n= "y"\nc = "z"');
    expect(entries(data)).toEqual([["c", "z"]]);
    expect(data.warnings).toEqual([]);
  });

  it("warns duplicate-key and keeps the first", () => {
    const data = toml('title = "one"\nx = "y"\ntitle = "two"');
    expect(data.fields.get("title")).toBe("one");
    expect(data.warnings).toEqual([{ code: "duplicate-key", line: 4 }]);
  });

  it("reads CRLF input", () => {
    const data = read(
      '+++\r\ntitle = "A"\r\nlang = "fr"\r\n+++\r\n\r\nText\r\n',
    );
    expect(entries(data)).toEqual([
      ["title", "A"],
      ["lang", "fr"],
    ]);
  });

  it("applies the value and field limits with doc lines", () => {
    const long = "x".repeat(MAX_FRONTMATTER_VALUE_LENGTH + 1);
    const data = toml('a = "ok"\nb = "' + long + '"');
    expect(entries(data)).toEqual([["a", "ok"]]);
    expect(data.warnings).toEqual([{ code: "value-too-long", line: 3 }]);

    const lines: string[] = [];
    for (let i = 0; i < MAX_FRONTMATTER_FIELDS + 3; i += 1) {
      lines.push("k" + String(i) + ' = "v"');
    }
    const many = toml(lines.join("\n"));
    expect(many.fields.size).toBe(MAX_FRONTMATTER_FIELDS);
    expect(many.warnings).toEqual([
      { code: "too-many-fields", line: MAX_FRONTMATTER_FIELDS + 2 },
    ]);
  });
});

describe("frontmatterTitle", () => {
  it("trims the title", () => {
    expect(frontmatterTitle(yaml('title: "  Hi there  "'))).toBe("Hi there");
  });

  it("is undefined when missing or empty after trimming", () => {
    expect(frontmatterTitle(yaml("lang: en"))).toBeUndefined();
    expect(frontmatterTitle(yaml('title: "   "'))).toBeUndefined();
    expect(frontmatterTitle(yaml('title: ""'))).toBeUndefined();
  });
});

describe("isNonEnglish", () => {
  const cases: [string, boolean][] = [
    ["en", false],
    ["EN-us", false],
    ["en_GB", false],
    ["ja", true],
    ["zh-cn", true],
    ["pt-BR", true],
    ["fil", true],
    ["English", false],
    ["{{ .Lang }}", false],
    ['"  "', false],
    ['""', false],
    ["e", false],
    ["fr-", false],
  ];
  for (const [value, expected] of cases) {
    it("lang " + value + " is " + String(expected), () => {
      const body = value.startsWith('"') ? value : JSON.stringify(value);
      expect(isNonEnglish(yaml("lang: " + body))).toBe(expected);
    });
  }

  it("lists the language fields in order", () => {
    expect(LANGUAGE_FIELDS).toEqual(["lang", "language", "locale"]);
    expect(Object.isFrozen(LANGUAGE_FIELDS)).toBe(true);
  });

  it("lets the first present field decide", () => {
    expect(isNonEnglish(yaml("lang: en\nlanguage: fr"))).toBe(false);
    expect(isNonEnglish(yaml("language: fr\nlocale: en"))).toBe(true);
    expect(isNonEnglish(yaml("locale: fr"))).toBe(true);
    expect(isNonEnglish(yaml("lang: English\nlanguage: fr"))).toBe(false);
  });

  it("is false with no language field", () => {
    expect(isNonEnglish(yaml("title: x"))).toBe(false);
  });

  it("works for TOML", () => {
    expect(isNonEnglish(toml('language = "ja"'))).toBe(true);
  });
});
