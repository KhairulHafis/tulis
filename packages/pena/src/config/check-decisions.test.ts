import { describe, expect, it } from "vitest";
import { parseYaml } from "./parse-yaml.js";
import { checkDecisions } from "./check-decisions.js";
import type { DecisionsCheckResult } from "./check-decisions.js";

function check(text: string): DecisionsCheckResult {
  const parsed = parseYaml(text, {});
  return checkDecisions(parsed.value, parsed.lineOf);
}

function entry(
  check_: string,
  count: string,
  last: string,
  version = "version: 1\n",
): string {
  return `${version}dismissals:\n  - check: ${check_}\n    count: ${count}\n    last: ${last}\n`;
}

const GOOD = entry("term.sign-in", "3", '"2026-11-27"');

describe("checkDecisions", () => {
  it("reads the approved example", () => {
    const result = check(GOOD);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.fileVersion).toBe(1);
    expect(result.dismissals).toEqual([
      { check: "term.sign-in", count: 3, last: "2026-11-27" },
    ]);
    expect(Object.isFrozen(result.dismissals)).toBe(true);
    expect(Object.isFrozen(result.dismissals[0])).toBe(true);
  });

  it("accepts an unquoted date", () => {
    const result = check(entry("heading.case", "1", "2026-11-27"));
    expect(result.errors).toEqual([]);
    expect(result.dismissals[0]?.last).toBe("2026-11-27");
  });

  it("treats an empty or comments-only file as empty with no warnings", () => {
    for (const text of ["", "# nothing\n"]) {
      const result = check(text);
      expect(result.dismissals).toEqual([]);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
    }
  });

  it("rejects a top level that is not a map", () => {
    const result = check("- a\n- b\n");
    expect(result.errors).toHaveLength(1);
    expect(result.dismissals).toEqual([]);
  });

  it("allows a file with a version and no dismissals", () => {
    const result = check("version: 1\n");
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("keeps file order", () => {
    const text = `version: 1
dismissals:
  - { check: b.two, count: 1, last: "2026-01-01" }
  - { check: a.one, count: 2, last: "2026-01-02" }
`;
    expect(check(text).dismissals.map((d) => d.check)).toEqual([
      "b.two",
      "a.one",
    ]);
  });

  describe("dismissals", () => {
    it("must be a list", () => {
      const result = check("version: 1\ndismissals: 5\n");
      expect(result.errors.map((e) => e.key)).toEqual(["dismissals"]);
    });

    it("skips an entry that is not a map and keeps the others", () => {
      const text = `${GOOD}  - just text\n`;
      const result = check(text);
      expect(result.dismissals).toHaveLength(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.key).toBe("dismissals[2]");
      expect(result.errors[0]?.line).toBe(6);
    });

    it("keeps none and gives one error for more than 1000 entries", () => {
      const lines = ["version: 1", "dismissals:"];
      for (let i = 0; i < 1001; i += 1) {
        lines.push(
          `  - { check: "a.c${String(i)}", count: 1, last: "2026-01-01" }`,
        );
      }
      const result = check(lines.join("\n"));
      expect(result.dismissals).toEqual([]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.message).toContain("1000");
    });

    it("accepts exactly 1000 entries", () => {
      const lines = ["version: 1", "dismissals:"];
      for (let i = 0; i < 1000; i += 1) {
        lines.push(
          `  - { check: "a.c${String(i)}", count: 1, last: "2026-01-01" }`,
        );
      }
      const result = check(lines.join("\n"));
      expect(result.dismissals).toHaveLength(1000);
      expect(result.errors).toEqual([]);
    });
  });

  describe("check", () => {
    it.each([
      "term.sign-in",
      "heading.case",
      "a.b.c.d",
      "x1.y2-z3",
      `${"a".repeat(60)}.${"b".repeat(60)}`,
    ])("accepts %s", (id) => {
      const result = check(entry(id, "1", '"2026-01-01"'));
      expect(result.errors).toEqual([]);
      expect(result.dismissals).toHaveLength(1);
    });

    it.each([
      "term",
      "a.b.c.d.e",
      "Term.sign-in",
      "term.-in",
      "term.in-",
      "term..in",
      "term.sign_in",
      "term.sign--in",
      ".term",
      "term.",
      `${"a".repeat(65)}.${"b".repeat(64)}`,
      "5",
      "true",
    ])("rejects %s", (id) => {
      const result = check(entry(`"${id}"`, "1", '"2026-01-01"'));
      expect(result.dismissals).toEqual([]);
      expect(result.errors[0]?.key).toBe("dismissals[1].check");
    });

    it("rejects a check that is not a string", () => {
      const result = check(entry("[a, b]", "1", '"2026-01-01"'));
      expect(result.dismissals).toEqual([]);
      expect(result.errors).toHaveLength(1);
    });

    it("is required", () => {
      const result = check(
        'version: 1\ndismissals:\n  - count: 1\n    last: "2026-01-01"\n',
      );
      expect(result.errors[0]?.message).toBe("check is required.");
      expect(result.dismissals).toEqual([]);
    });
  });

  describe("count", () => {
    it.each(["1", "1000000", "42"])("accepts %s", (count) => {
      expect(check(entry("a.b", count, '"2026-01-01"')).errors).toEqual([]);
    });

    it.each(["0", "-1", "1000001", "1.5", '"3"', "true", ".inf", "1e3x"])(
      "rejects %s",
      (count) => {
        const result = check(entry("a.b", count, '"2026-01-01"'));
        expect(result.dismissals).toEqual([]);
        expect(result.errors[0]?.key).toBe("dismissals[1].count");
      },
    );

    it("is required", () => {
      const result = check(
        'version: 1\ndismissals:\n  - check: a.b\n    last: "2026-01-01"\n',
      );
      expect(result.errors[0]?.message).toBe("count is required.");
    });
  });

  describe("last", () => {
    it.each([
      '"2026-11-27"',
      '"2000-01-01"',
      '"2999-12-31"',
      '"2024-02-29"',
      '"2026-02-28"',
    ])("accepts %s", (last) => {
      expect(check(entry("a.b", "1", last)).errors).toEqual([]);
    });

    it.each([
      '"2026-02-30"',
      '"2026-02-29"',
      '"2100-02-29"',
      '"2026-13-01"',
      '"2026-00-10"',
      '"2026-04-31"',
      '"2026-1-1"',
      '"2026-11-27T10:00"',
      '"2026-11-27 10:00"',
      '"1999-12-31"',
      '"3000-01-01"',
      "20261127",
      '"2026-11-27\\n"',
      '""',
      '"tomorrow"',
    ])("rejects %s", (last) => {
      const result = check(entry("a.b", "1", last));
      expect(result.dismissals).toEqual([]);
      expect(result.errors[0]?.key).toBe("dismissals[1].last");
    });

    it("is required", () => {
      const result = check(
        "version: 1\ndismissals:\n  - check: a.b\n    count: 1\n",
      );
      expect(result.errors[0]?.message).toBe("last is required.");
    });
  });

  it("keeps the first of a duplicate check and reports the line of the first", () => {
    const text = `version: 1
dismissals:
  - { check: a.b, count: 1, last: "2026-01-01" }
  - { check: c.d, count: 1, last: "2026-01-01" }
  - { check: a.b, count: 9, last: "2026-02-02" }
`;
    const result = check(text);
    expect(result.dismissals.map((d) => d.count)).toEqual([1, 1]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.line).toBe(5);
    expect(result.errors[0]?.message).toContain("already listed on line 3");
  });

  it("reports a duplicate without a line when there is no line lookup", () => {
    const entryValue = { check: "a.b", count: 1, last: "2026-01-01" };
    const result = checkDecisions({
      version: 1,
      dismissals: [entryValue, entryValue],
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.line).toBeUndefined();
  });

  it("does not let a bad first entry block a later one with the same check", () => {
    const text = `version: 1
dismissals:
  - { check: a.b, count: 0, last: "2026-01-01" }
  - { check: a.b, count: 2, last: "2026-01-01" }
`;
    const result = check(text);
    expect(result.dismissals.map((d) => d.count)).toEqual([2]);
    expect(result.errors).toHaveLength(1);
  });

  describe("unknown keys", () => {
    it("warns with a did-you-mean hint", () => {
      const text = `version: 1
dismissals:
  - check: a.b
    cout: 3
    count: 3
    last: "2026-01-01"
`;
      const result = check(text);
      expect(result.errors).toEqual([]);
      expect(result.dismissals).toHaveLength(1);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]?.message).toContain('Did you mean "count"?');
      expect(result.warnings[0]?.line).toBe(4);
    });

    it("warns about unknown top-level keys", () => {
      const result = check(`${GOOD}dismissal: []\n`);
      expect(result.warnings[0]?.message).toContain(
        'Did you mean "dismissals"?',
      );
    });

    it("treats __proto__ as an ordinary unknown key", () => {
      const text = `version: 1
dismissals:
  - check: a.b
    count: 1
    last: "2026-01-01"
    __proto__: {count: 5}
`;
      const result = check(text);
      expect(result.dismissals).toEqual([
        { check: "a.b", count: 1, last: "2026-01-01" },
      ]);
      expect(result.warnings).toHaveLength(1);
      expect(({} as Record<string, unknown>)["count"]).toBeUndefined();
    });

    it("does not read a count from the prototype", () => {
      const result = checkDecisions({
        version: 1,
        dismissals: [
          Object.create({ check: "a.b", count: 1, last: "2026-01-01" }),
        ],
      });
      expect(result.dismissals).toEqual([]);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe("version", () => {
    it("warns when missing and reads as version 1", () => {
      const result = check(entry("a.b", "1", '"2026-01-01"', ""));
      expect(result.fileVersion).toBeUndefined();
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]?.key).toBe("version");
      expect(result.dismissals).toHaveLength(1);
    });

    it("reports a newer version", () => {
      const result = check(entry("a.b", "1", '"2026-01-01"', "version: 2\n"));
      expect(result.fileVersion).toBe(2);
      expect(result.dismissals).toHaveLength(1);
    });

    it.each(["0", "-1", "1.5", '"1"', "true"])(
      "rejects version %s",
      (version) => {
        const result = check(
          entry("a.b", "1", '"2026-01-01"', `version: ${version}\n`),
        );
        expect(result.fileVersion).toBeUndefined();
        expect(result.errors.map((e) => e.key)).toContain("version");
      },
    );
  });

  it("never echoes values in messages", () => {
    const text = `version: 1
dismissals:
  - check: "TOPSECRET.Bad"
    count: "TOPSECRET"
    last: "TOPSECRET"
`;
    const result = check(text);
    const everything = JSON.stringify([result.errors, result.warnings]);
    expect(everything).not.toContain("TOPSECRET");
    expect(result.errors).toHaveLength(3);
  });

  it("never throws on odd input", () => {
    for (const value of [
      undefined,
      5,
      "text",
      [],
      true,
      { dismissals: [[]] },
    ]) {
      expect(() => checkDecisions(value)).not.toThrow();
    }
  });
});
