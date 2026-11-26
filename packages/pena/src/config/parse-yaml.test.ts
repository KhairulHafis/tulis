import { describe, expect, it } from "vitest";
import { YamlParseError, parseYaml } from "./parse-yaml.js";

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
