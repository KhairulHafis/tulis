import { describe, expect, it } from "vitest";
import {
  htmlCommentBody,
  mdxCommentBody,
  readIgnoreComment,
} from "./ignore-comment.js";

function timed<T>(run: () => T): { value: T; ms: number } {
  const start = performance.now();
  const value = run();
  return { value, ms: performance.now() - start };
}

describe("ignore comment security", () => {
  it("rejects a 1,001-character ignore body as too-long", () => {
    const body = "tulis-ignore" + " ".repeat(989);
    expect(body).toHaveLength(1001);
    expect(readIgnoreComment(body)).toEqual({
      status: "malformed",
      problem: "too-long",
    });
    expect(readIgnoreComment("  TULIS-IGNORE" + "a".repeat(1000))).toEqual({
      status: "malformed",
      problem: "too-long",
    });
  });

  it("does not treat a long ordinary comment as an ignore", () => {
    expect(readIgnoreComment("todo " + "a".repeat(996))).toEqual({
      status: "not-ignore",
    });
  });

  it("reads a 1,000-character body of many pieces quickly", () => {
    const body = "tulis-ignore " + "a.b, ".repeat(196) + "a.b" + " ".repeat(4);
    expect(body).toHaveLength(1000);
    const { value, ms } = timed(() => readIgnoreComment(body));
    expect(value.status).toBe("ignore");
    expect(ms).toBeLessThan(50);
  });

  it.each([",", ":", " ", "\t", "\n"])(
    "returns quickly for 100,000 of %j",
    (char) => {
      const { value, ms } = timed(() =>
        readIgnoreComment(char.repeat(100_000)),
      );
      expect(value.status).toBe("not-ignore");
      expect(ms).toBeLessThan(50);
    },
  );

  it("is quick on a long ignore body of commas", () => {
    const { value, ms } = timed(() =>
      readIgnoreComment("tulis-ignore" + ",".repeat(100_000)),
    );
    expect(value).toEqual({ status: "malformed", problem: "too-long" });
    expect(ms).toBeLessThan(50);
  });

  it("returns undefined quickly for 1 MB of repeated openers", () => {
    const html = "<!--".repeat(262_144);
    const mdx = "/*".repeat(524_288);
    const a = timed(() => htmlCommentBody(html));
    const b = timed(() => mdxCommentBody(mdx));
    expect(a.value).toBeUndefined();
    expect(b.value).toBeUndefined();
    expect(a.ms).toBeLessThan(100);
    expect(b.ms).toBeLessThan(100);
  });

  it("replaces bidi and control characters in a reason", () => {
    const reading = readIgnoreComment(
      "tulis-ignore: a\u202eb\u2066c\u0000d\u001be\u200ff\u061cg",
    );
    expect(reading).toEqual({
      status: "ignore",
      comment: { kind: "next", checks: [], reason: "a?b?c?d?e?f?g" },
    });
  });
});
