import { describe, expect, it } from "vitest";
import {
  htmlCommentBody,
  MAX_IGNORE_CHECKS,
  MAX_IGNORE_COMMENT_LENGTH,
  mdxCommentBody,
  readIgnoreComment,
} from "./ignore-comment.js";
import type { IgnoreCommentKind } from "./ignore-comment.js";

function ignored(
  body: string,
  kind: IgnoreCommentKind,
  checks: readonly string[],
  reason: string | undefined,
): void {
  expect(readIgnoreComment(body)).toEqual({
    status: "ignore",
    comment: { kind, checks, reason },
  });
}

describe("readIgnoreComment forms", () => {
  it("reads the plain form", () => {
    ignored(" tulis-ignore ", "next", [], undefined);
    ignored("tulis-ignore", "next", [], undefined);
  });

  it("reads one check ID", () => {
    ignored(" tulis-ignore term.sign-in ", "next", ["term.sign-in"], undefined);
  });

  it("reads a reason", () => {
    ignored(
      " tulis-ignore: quoting the UI label ",
      "next",
      [],
      "quoting the UI label",
    );
  });

  it("reads check IDs and a reason", () => {
    ignored(
      "tulis-ignore term.sign-in: quoting the UI label",
      "next",
      ["term.sign-in"],
      "quoting the UI label",
    );
  });

  it("reads start and end", () => {
    ignored("tulis-ignore-start", "start", [], undefined);
    ignored("tulis-ignore-start a.b: why", "start", ["a.b"], "why");
    ignored("tulis-ignore-end", "end", [], undefined);
  });

  it("keeps a reason on an end", () => {
    ignored("tulis-ignore-end: done", "end", [], "done");
  });
});

describe("readIgnoreComment check IDs", () => {
  it("splits on spaces, commas and both", () => {
    ignored("tulis-ignore a.b c.d", "next", ["a.b", "c.d"], undefined);
    ignored("tulis-ignore a.b,c.d", "next", ["a.b", "c.d"], undefined);
    ignored(
      "tulis-ignore a.b, c.d ,, e.f",
      "next",
      ["a.b", "c.d", "e.f"],
      undefined,
    );
  });

  it("removes duplicates and keeps the first order", () => {
    ignored("tulis-ignore c.d a.b c.d a.b", "next", ["c.d", "a.b"], undefined);
  });

  it("allows exactly the maximum number of IDs", () => {
    const ids = Array.from(
      { length: MAX_IGNORE_CHECKS },
      (_, i) => `a.b${String(i)}`,
    );
    ignored(`tulis-ignore ${ids.join(" ")}`, "next", ids, undefined);
  });

  it("counts IDs after removing duplicates", () => {
    const ids = Array.from(
      { length: MAX_IGNORE_CHECKS },
      (_, i) => `a.b${String(i)}`,
    );
    ignored(
      `tulis-ignore ${ids.join(" ")} ${ids.join(" ")}`,
      "next",
      ids,
      undefined,
    );
  });
});

describe("readIgnoreComment reason", () => {
  it("keeps colons inside the reason", () => {
    ignored("tulis-ignore: a: b", "next", [], "a: b");
  });

  it("treats an empty reason as missing", () => {
    ignored("tulis-ignore:", "next", [], undefined);
    ignored("tulis-ignore a.b:   ", "next", ["a.b"], undefined);
  });

  it("makes the reason safe", () => {
    ignored("tulis-ignore: a\u0001b", "next", [], "a?b");
    ignored("tulis-ignore: a\u202eb", "next", [], "a?b");
  });

  it("cuts a long reason to 200 characters plus dots", () => {
    ignored(
      "tulis-ignore: " + "x".repeat(300),
      "next",
      [],
      `${"x".repeat(200)}...`,
    );
  });
});

describe("readIgnoreComment layout", () => {
  it("reads a comment that spans lines", () => {
    ignored(
      "\n  tulis-ignore\n  a.b,\n  c.d\n  : because\n  of reasons\n",
      "next",
      ["a.b", "c.d"],
      "because?  of reasons",
    );
  });

  it("allows extra whitespace and tabs", () => {
    ignored("\t tulis-ignore \t a.b \t : \t why \t", "next", ["a.b"], "why");
  });
});

describe("readIgnoreComment malformed", () => {
  it.each([
    "tulis-ignored",
    "TULIS-IGNORE",
    "tulis-ignore-begin",
    "Tulis-Ignore-End",
    "tulis-ignore,a.b",
  ])("unknown form: %s", (body) => {
    expect(readIgnoreComment(body)).toEqual({
      status: "malformed",
      problem: "unknown-form",
    });
  });

  it.each([
    "tulis-ignore term",
    "tulis-ignore A.b",
    "tulis-ignore a.b x",
    "tulis-ignore-start a..b",
  ])("bad check ID: %s", (body) => {
    expect(readIgnoreComment(body)).toEqual({
      status: "malformed",
      problem: "bad-check-id",
    });
  });

  it("rejects too many checks", () => {
    const ids = Array.from(
      { length: MAX_IGNORE_CHECKS + 1 },
      (_, i) => `a.b${String(i)}`,
    );
    expect(readIgnoreComment(`tulis-ignore ${ids.join(" ")}`)).toEqual({
      status: "malformed",
      problem: "too-many-checks",
    });
  });

  it("rejects an end with check IDs", () => {
    expect(readIgnoreComment("tulis-ignore-end a.b")).toEqual({
      status: "malformed",
      problem: "end-with-checks",
    });
  });

  it("rejects a body over the length limit", () => {
    const body = `tulis-ignore: ${"x".repeat(MAX_IGNORE_COMMENT_LENGTH)}`;
    expect(readIgnoreComment(body)).toEqual({
      status: "malformed",
      problem: "too-long",
    });
  });

  it("accepts a body of exactly the maximum length", () => {
    const head = "tulis-ignore: ";
    const body = head + "x".repeat(MAX_IGNORE_COMMENT_LENGTH - head.length);
    expect(body).toHaveLength(MAX_IGNORE_COMMENT_LENGTH);
    expect(readIgnoreComment(body).status).toBe("ignore");
  });
});

describe("readIgnoreComment problem order", () => {
  // Order: too-long, unknown-form, end-with-checks, bad-check-id, too-many-checks.
  const many = Array.from(
    { length: MAX_IGNORE_CHECKS + 1 },
    (_, i) => `a.b${String(i)}`,
  ).join(" ");

  function problem(body: string): string | undefined {
    const reading = readIgnoreComment(body);
    return reading.status === "malformed" ? reading.problem : undefined;
  }

  it("puts too-long before unknown-form", () => {
    expect(problem(`tulis-ignored ${"x".repeat(1000)}`)).toBe("too-long");
  });

  it("puts unknown-form before the check problems", () => {
    expect(problem("tulis-ignore-begin BAD")).toBe("unknown-form");
  });

  it("puts end-with-checks before bad-check-id", () => {
    expect(problem("tulis-ignore-end BAD")).toBe("end-with-checks");
  });

  it("puts bad-check-id before too-many-checks", () => {
    expect(problem(`tulis-ignore ${many} BAD`)).toBe("bad-check-id");
    expect(problem(`tulis-ignore ${many}`)).toBe("too-many-checks");
  });
});

describe("readIgnoreComment ordinary comments", () => {
  it.each([
    "",
    " ",
    " TODO ",
    " tulis is great ",
    "tulis-ignor",
    "ignore tulis-ignore",
    "a".repeat(2000),
  ])("is not an ignore comment: %j", (body) => {
    expect(readIgnoreComment(body)).toEqual({ status: "not-ignore" });
  });
});

describe("htmlCommentBody", () => {
  it("returns the text between the markers", () => {
    expect(htmlCommentBody("  <!-- a -->\n")).toBe(" a ");
    expect(htmlCommentBody("<!---->")).toBe("");
    expect(htmlCommentBody("<!--\nx\ny\n-->")).toBe("\nx\ny\n");
  });

  it.each([
    "<!-- a --> <!-- b -->",
    "<!-- a --> text",
    "<div>",
    "<!-- a",
    "",
    "<!-->",
    "text <!-- a -->",
    "<!-- a --> --> ",
  ])("returns undefined for %j", (value) => {
    expect(htmlCommentBody(value)).toBeUndefined();
  });
});

describe("mdxCommentBody", () => {
  it("returns the text between the markers", () => {
    expect(mdxCommentBody("  /* a */\n")).toBe(" a ");
    expect(mdxCommentBody("/**/")).toBe("");
    expect(mdxCommentBody("/*\nx\n*/")).toBe("\nx\n");
  });

  it.each([
    "/* a */ x",
    "/* a */ /* b */",
    "x",
    "// a",
    "",
    "/*/",
    "/* a",
    "x /* a */",
  ])("returns undefined for %j", (value) => {
    expect(mdxCommentBody(value)).toBeUndefined();
  });
});

describe("body functions with readIgnoreComment", () => {
  it("feeds HTML and MDX comments through the same reader", () => {
    const html = htmlCommentBody(
      "<!-- tulis-ignore term.sign-in: ui label -->",
    );
    const mdx = mdxCommentBody("/* tulis-ignore term.sign-in: ui label */");
    expect(html).toBeDefined();
    expect(mdx).toBeDefined();
    expect(readIgnoreComment(html ?? "")).toEqual(readIgnoreComment(mdx ?? ""));
    ignored(html ?? "", "next", ["term.sign-in"], "ui label");
  });
});
