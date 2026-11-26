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

function aliasBomb(): string {
  const lines = ["a: &a0 [x, x, x, x, x, x, x, x, x]"];
  for (let level = 1; level < 9; level++) {
    const refs = Array.from({ length: 9 }, () => `*a${String(level - 1)}`);
    lines.push(`a${String(level)}: &a${String(level)} [${refs.join(", ")}]`);
  }
  return lines.join("\n") + "\n";
}

describe("alias limits", () => {
  it("refuses a billion-laughs alias bomb quickly", () => {
    const start = Date.now();
    const error = errorOf(aliasBomb());
    expect(Date.now() - start).toBeLessThan(1000);
    expect(error.message).toContain("alias");
  });

  it("allows up to maxAliases aliases and refuses one more", () => {
    const build = (count: number): string =>
      "base: &b 1\n" +
      Array.from({ length: count }, (_, i) => `k${String(i)}: *b`).join("\n") +
      "\n";
    expect(parseYaml(build(10), { maxAliases: 10 }).value).toBeTruthy();
    expect(errorOf(build(11), { maxAliases: 10 }).message).toContain("alias");
  });

  it("refuses any alias when maxAliases is 0", () => {
    expect(errorOf("a: &x 1\nb: *x\n", { maxAliases: 0 }).message).toContain(
      "alias",
    );
  });

  it("keeps the alias message free of anchor names", () => {
    const error = errorOf("a: *secretname\n");
    expect(error.message).not.toContain("secretname");
  });
});

describe("size limit", () => {
  it("accepts input of exactly maxBytes", () => {
    const text = "a: " + "x".repeat(37);
    expect(Buffer.byteLength(text)).toBe(40);
    expect(parseYaml(text, { maxBytes: 40 }).value).toEqual({
      a: "x".repeat(37),
    });
  });

  it("refuses input one byte over maxBytes", () => {
    const error = errorOf("a: " + "x".repeat(38), { maxBytes: 40 });
    expect(error.message).toContain("larger than the limit");
    expect(error.message).toContain("KB");
    expect(error.line).toBeUndefined();
  });

  it("counts multi-byte characters as bytes", () => {
    // "a: " is 3 bytes, each euro sign is 3 bytes: 3 + 12 = 15 bytes.
    const text = "a: " + "\u20ac".repeat(4);
    expect(parseYaml(text, { maxBytes: 15 }).value).toBeTruthy();
    expect(() => parseYaml(text, { maxBytes: 14 })).toThrow(YamlParseError);
  });

  it("refuses large input by default", () => {
    expect(() => parseYaml("a: " + "x".repeat(70 * 1024))).toThrow(
      YamlParseError,
    );
  });
});

describe("nesting limit", () => {
  it("accepts maps at maxDepth and refuses one deeper", () => {
    const maps = (depth: number): string => {
      const lines: string[] = [];
      for (let i = 0; i < depth; i++) {
        lines.push(`${"  ".repeat(i)}k:`);
      }
      return lines.join("\n") + " 1\n";
    };
    expect(parseYaml(maps(5), { maxDepth: 5 }).value).toBeTruthy();
    const error = errorOf(maps(6), { maxDepth: 5 });
    expect(error.message).toContain("nesting");
  });

  it("accepts lists at maxDepth and refuses one deeper", () => {
    const lists = (depth: number): string =>
      "[".repeat(depth) + "]".repeat(depth);
    expect(parseYaml(lists(5), { maxDepth: 5 }).value).toBeTruthy();
    expect(errorOf(lists(6), { maxDepth: 5 }).message).toContain("nesting");
  });

  it("counts a map holding a list as depth 2", () => {
    expect(parseYaml("a: [1]", { maxDepth: 2 }).value).toBeTruthy();
    expect(() => parseYaml("a: [1]", { maxDepth: 1 })).toThrow(YamlParseError);
  });

  it("uses a default depth of 32", () => {
    expect(parseYaml("[".repeat(32) + "]".repeat(32)).value).toBeTruthy();
    expect(() => parseYaml("[".repeat(33) + "]".repeat(33))).toThrow(
      YamlParseError,
    );
  });

  it("counts depth through aliases", () => {
    const text = "a: &x [[1]]\nb: [[*x]]\n";
    expect(parseYaml(text, { maxDepth: 5 }).value).toBeTruthy();
    expect(errorOf(text, { maxDepth: 4 }).message).toContain("nesting");
  });

  it("refuses 60,000 nested brackets without crashing", () => {
    const error = errorOf("[".repeat(60000), { maxBytes: 100000 });
    expect(error.message).toContain("nesting");
  });

  it("refuses 60,000 matched brackets without crashing", () => {
    const text = "[".repeat(60000) + "]".repeat(60000);
    expect(errorOf(text, { maxBytes: 200000 }).message).toContain("nesting");
  });

  it("refuses a recursive anchor quickly", () => {
    const start = Date.now();
    expect(() => parseYaml("&a [*a, *a]\n", { maxAliases: 100 })).toThrow(
      YamlParseError,
    );
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

describe("duplicate keys, documents, tags", () => {
  it("refuses duplicate keys with the line of the second", () => {
    const error = errorOf("a: 1\nb: 2\na: 3\n");
    expect(error.line).toBe(3);
  });

  it("refuses two documents", () => {
    expect(() => parseYaml("a: 1\n---\nb: 2\n")).toThrow(YamlParseError);
  });

  it.each([
    "a: !!binary aGVsbG8=",
    "a: !!js/function 'function(){}'",
    "a: !custom x",
    "a: !!timestamp 2026-01-01",
    "a: !!set {x}",
    "a: !!omap [x: 1]",
    "a: !!js/regexp /x/",
  ])("refuses the tag in %s", (text) => {
    const error = errorOf(text);
    expect(error.line).toBe(1);
  });

  it("refuses a tag on a nested value, with its line", () => {
    expect(errorOf("a:\n  b: !custom x\n").line).toBe(2);
  });

  it("does not merge << keys", () => {
    const result = parseYaml("base: &base\n  x: 1\nchild:\n  <<: *base\n", {
      maxAliases: 10,
    });
    expect(result.value).toEqual({
      base: { x: 1 },
      child: { "<<": { x: 1 } },
    });
  });
});

describe("prototype safety", () => {
  it("keeps __proto__ as an own property at the top level and nested", () => {
    const result = parseYaml(
      "__proto__: { polluted: true }\nnested:\n  __proto__: { deep: true }\n",
    );
    const value = result.value as Record<string, unknown>;
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(Object.hasOwn(value, "__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(value, "__proto__")?.value).toEqual({
      polluted: true,
    });
    const nested = value["nested"] as Record<string, unknown>;
    expect(Object.getPrototypeOf(nested)).toBe(Object.prototype);
    expect(Object.hasOwn(nested, "__proto__")).toBe(true);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(({} as Record<string, unknown>)["deep"]).toBeUndefined();
    expect(value["polluted"]).toBeUndefined();
  });

  it("keeps constructor and prototype keys as plain data", () => {
    const result = parseYaml("constructor: { prototype: { x: 1 } }\n");
    expect(({} as Record<string, unknown>)["x"]).toBeUndefined();
    expect(result.value).toEqual({ constructor: { prototype: { x: 1 } } });
  });

  it("finds the line of a __proto__ key", () => {
    expect(parseYaml("a: 1\n__proto__: 2\n").lineOf(["__proto__"])).toBe(2);
  });
});

describe("keys must be plain strings", () => {
  it.each([
    ["numeric", "a: 1\n2: x\n"],
    ["boolean", "a: 1\ntrue: x\n"],
    ["null", "a: 1\nnull: x\n"],
    ["complex", "a: 1\n? [a]\n: x\n"],
    ["map", "a: 1\n? {b: c}\n: x\n"],
  ])("refuses a %s key with its line", (_name, text) => {
    const error = errorOf(text);
    expect(error.line).toBe(2);
  });

  it("accepts quoted numbers as string keys", () => {
    expect(parseYaml("'2': x\n").value).toEqual({ "2": "x" });
  });
});

describe("error messages", () => {
  it("never contain control characters", () => {
    const error = errorOf("a: !bad\u001bthing x\n");
    expect(error.message).not.toContain("\u001b");
  });

  it("never contain bidi overrides", () => {
    const error = errorOf("a: !bad\u202ething x\n");
    expect(error.message).not.toContain("\u202e");
  });

  it("stay on one line and are short", () => {
    const error = errorOf("a: !" + "x".repeat(5000) + " y\n");
    expect(error.message).not.toContain("\n");
    expect(error.message.length).toBeLessThan(300);
  });
});
