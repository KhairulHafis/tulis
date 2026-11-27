import { describe, expect, it } from "vitest";
import { expectLinearTime, repeatToSize } from "@tulis/testkit";
import { MAX_FRONTMATTER_BYTES, readFrontmatter } from "./frontmatter-data.js";
import { parseMarkdown } from "./parse-markdown.js";

function frontmatterOf(text: string) {
  const parsed = parseMarkdown(text, "markdown");
  if (parsed.kind !== "parsed" || parsed.frontmatter === undefined) {
    throw new Error("no frontmatter");
  }
  return parsed.frontmatter;
}

function yaml(body: string) {
  return readFrontmatter(frontmatterOf("---\n" + body + "\n---\n"));
}

function toml(body: string) {
  return readFrontmatter(frontmatterOf("+++\n" + body + "\n+++\n"));
}

describe("size limit", () => {
  it("reads nothing from YAML over the limit", () => {
    const body = "title: " + "x".repeat(MAX_FRONTMATTER_BYTES);
    const data = yaml(body);
    expect(data.fields.size).toBe(0);
    expect(data.warnings).toEqual([{ code: "too-large", line: 1 }]);
  });

  it("reads nothing from valid TOML of 64 KB + 1 byte", () => {
    // Only the size check stops this: every line is a valid, small field.
    const line = 'k = "v"\n';
    const body = repeatToSize(line, MAX_FRONTMATTER_BYTES + 1);
    const data = toml(body);
    expect(data.fields.size).toBe(0);
    expect(data.warnings).toEqual([{ code: "too-large", line: 1 }]);
  });

  it("counts UTF-8 bytes, not characters", () => {
    // 22,000 three-byte characters are under 64K characters but over 64 KB.
    const euro = String.fromCodePoint(0x20ac);
    const data = toml('title = "' + euro.repeat(22000) + '"');
    expect(data.warnings).toEqual([{ code: "too-large", line: 1 }]);
  });

  it("reads a TOML body of exactly 64 KB", () => {
    const body = 'k = "v"\n' + "#".repeat(MAX_FRONTMATTER_BYTES - 8);
    expect(Buffer.byteLength(body, "utf8")).toBe(MAX_FRONTMATTER_BYTES);
    const data = toml(body);
    expect(data.fields.get("k")).toBe("v");
    expect(data.warnings).toEqual([]);
  });
});

describe("hostile YAML", () => {
  it("reports an alias bomb as invalid-yaml", () => {
    const lines = ["a0: &a0 [x, x, x, x, x, x, x, x, x]"];
    for (let i = 1; i < 12; i += 1) {
      const prev = "*a" + String(i - 1);
      lines.push(
        "a" +
          String(i) +
          ": &a" +
          String(i) +
          " [" +
          Array(9).fill(prev).join(", ") +
          "]",
      );
    }
    const data = yaml(lines.join("\n"));
    expect(data.fields.size).toBe(0);
    expect(data.warnings.map((w) => w.code)).toEqual(["invalid-yaml"]);
  });

  it("reports 40-deep nesting as invalid-yaml", () => {
    const data = yaml("a: " + "[".repeat(40) + "]".repeat(40));
    expect(data.fields.size).toBe(0);
    expect(data.warnings.map((w) => w.code)).toEqual(["invalid-yaml"]);
  });
});

describe("hostile TOML stays linear", () => {
  const cases: [string, string][] = [
    ["quotes", '"'],
    ["backslashes", "\\\\"],
    ["an unterminated assignment", 'a = "'],
    ["triple quotes", '"""'],
    ["escaped quotes in a string", 'a = "\\"'],
    ["literal triple quotes", "'''"],
    ["unterminated literal assignments", "a = '"],
  ];
  for (const [name, unit] of cases) {
    it("repeated " + name, () => {
      expectLinearTime({
        prepare: (size) => {
          const fm = frontmatterOf(
            "+++\n" + repeatToSize(unit, size) + "\n+++\n",
          );
          return () => readFrontmatter(fm);
        },
        probe: { size: 8 * 1024, limitMs: 50 },
        sizes: [16 * 1024, 60 * 1024],
        smallLimitMs: 100,
        largeLimitMs: 200,
        slack: 4,
        floorMs: 50,
      });
    });
  }

  it("stays linear for many short lines", () => {
    expectLinearTime({
      prepare: (size) => {
        const fm = frontmatterOf(
          "+++\n" + repeatToSize('a = "\\\\"\n', size) + "\n+++\n",
        );
        return () => readFrontmatter(fm);
      },
      probe: { size: 8 * 1024, limitMs: 50 },
      sizes: [16 * 1024, 60 * 1024],
      smallLimitMs: 100,
      largeLimitMs: 200,
      slack: 4,
      floorMs: 50,
    });
  });
});

describe("prototype keys", () => {
  it("keeps __proto__ and constructor as plain YAML fields", () => {
    const data = yaml('__proto__: "x"\nconstructor: "y"\npolluted: "z"');
    expect(data.fields.get("__proto__")).toBe("x");
    expect(data.fields.get("constructor")).toBe("y");
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(Object.getPrototypeOf(data.fields)).toBe(Map.prototype);
  });

  it("keeps __proto__ and constructor as plain TOML fields", () => {
    const data = toml('__proto__ = "x"\nconstructor = "y"\npolluted = "z"');
    expect(data.fields.get("__proto__")).toBe("x");
    expect(data.fields.get("constructor")).toBe("y");
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });
});
