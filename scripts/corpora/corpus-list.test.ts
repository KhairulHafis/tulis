import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MAX_CORPUS_LIST_BYTES,
  loadCorpusList,
  parseCorpusList,
} from "./corpus-list.ts";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";

function entry(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name: "docs",
    url: "https://example.com/docs.git",
    branch: "main",
    commit: COMMIT,
    docsPath: "docs",
    ...overrides,
  };
}

function listText(entries: unknown[]): string {
  return JSON.stringify({ corpora: entries });
}

function parseWith(overrides: Record<string, unknown>): unknown {
  return parseCorpusList(listText([entry(overrides)]));
}

describe("loadCorpusList", () => {
  it("loads the real corpora.json", () => {
    const path = fileURLToPath(new URL("./corpora.json", import.meta.url));
    expect(loadCorpusList(path)).toEqual([
      {
        name: "kubernetes-website",
        url: "https://github.com/kubernetes/website.git",
        branch: "main",
        commit: "7c81c4a67b17aa329f277a53b9e9111fb03b0ede",
        docsPath: "content/en/docs",
      },
      {
        name: "gitlab",
        url: "https://gitlab.com/gitlab-org/gitlab.git",
        branch: "master",
        commit: "dbf97d490cc6d6626e436cfabcd08a6f8b72af35",
        docsPath: "doc",
      },
    ]);
  });

  it("refuses a file larger than the limit and names the path", () => {
    const dir = mkdtempSync(join(tmpdir(), "tulis-corpus-"));
    try {
      const path = join(dir, "big.json");
      writeFileSync(path, " ".repeat(MAX_CORPUS_LIST_BYTES + 1));
      expect(() => loadCorpusList(path)).toThrow(path);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("includes the path when the content is invalid", () => {
    const dir = mkdtempSync(join(tmpdir(), "tulis-corpus-"));
    try {
      const path = join(dir, "bad.json");
      writeFileSync(path, "{");
      expect(() => loadCorpusList(path)).toThrow(path);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("parseCorpusList", () => {
  it("parses a valid minimal list", () => {
    const result = parseCorpusList(listText([entry()]));
    expect(result).toEqual([entry()]);
  });

  it("rejects invalid JSON", () => {
    expect(() => parseCorpusList("{")).toThrow(/not valid JSON/);
  });

  it("rejects a non-object top level", () => {
    expect(() => parseCorpusList("[]")).toThrow(/must be an object/);
  });

  it("rejects a missing corpora key", () => {
    expect(() => parseCorpusList("{}")).toThrow(/corpora/);
  });

  it("rejects an empty array", () => {
    expect(() => parseCorpusList(listText([]))).toThrow(/not be empty/);
  });

  it("rejects an extra top-level key", () => {
    const text = JSON.stringify({ corpora: [entry()], extra: 1 });
    expect(() => parseCorpusList(text)).toThrow(/"extra"/);
  });

  it("rejects an entry that is not an object", () => {
    expect(() => parseCorpusList(listText(["x"]))).toThrow(
      /entry 1: must be an object/,
    );
  });

  it("rejects an unknown key", () => {
    expect(() => parseWith({ extra: "x" })).toThrow(/unknown key "extra"/);
  });

  it("rejects a missing key", () => {
    const rest = Object.fromEntries(
      Object.entries(entry()).filter(([key]) => key !== "commit"),
    );
    expect(() => parseCorpusList(listText([rest]))).toThrow(
      /missing key "commit"/,
    );
  });

  it("rejects a non-string value", () => {
    expect(() => parseWith({ branch: 5 })).toThrow(/"branch" must be a string/);
  });

  it("rejects duplicate names and names the entry", () => {
    expect(() => parseCorpusList(listText([entry(), entry()]))).toThrow(
      /entry 2 \("docs"\): "name" must be unique/,
    );
  });

  it.each(["../x", "--upload-pack=x", "Upper", "a/b", "a\\b", "", "-x"])(
    "rejects name %j",
    (name) => {
      expect(() => parseWith({ name })).toThrow(/"name"/);
    },
  );

  it("rejects a name longer than 64 characters", () => {
    expect(() => parseWith({ name: "a".repeat(65) })).toThrow(/"name"/);
  });

  it.each([
    "http://example.com/a.git",
    "ssh://example.com/a.git",
    "file:///etc/passwd",
    "https://user:pw@example.com/a.git",
    "https://user@example.com/a.git",
    "https://example.com/a.git?x=1",
    "https://example.com/a.git#frag",
    "not a url",
  ])("rejects url %j", (url) => {
    expect(() => parseWith({ url })).toThrow(/"url"/);
  });

  it.each(["-x", "a..b", "x.lock", "x.", ".x", "a b", "a/../b"])(
    "rejects branch %j",
    (branch) => {
      expect(() => parseWith({ branch })).toThrow(/"branch"/);
    },
  );

  it("rejects a branch longer than 100 characters", () => {
    expect(() => parseWith({ branch: "a".repeat(101) })).toThrow(/"branch"/);
  });

  it.each([
    "abc123",
    COMMIT.toUpperCase(),
    COMMIT + "0",
    "g".repeat(40),
    "main",
  ])("rejects commit %j", (commit) => {
    expect(() => parseWith({ commit })).toThrow(
      /"commit" must be a full 40-character lowercase commit hash/,
    );
  });

  it.each([
    "/abs",
    "../up",
    "a/../b",
    "a//b",
    "a\\b",
    "-x",
    ".hidden",
    ".",
    "",
    "a/",
  ])("rejects docsPath %j", (docsPath) => {
    expect(() => parseWith({ docsPath })).toThrow(/"docsPath"/);
  });

  it("rejects a docsPath longer than 200 characters", () => {
    expect(() => parseWith({ docsPath: "a".repeat(201) })).toThrow(
      /"docsPath"/,
    );
  });

  it("returns new frozen objects with only the five fields", () => {
    const [first] = parseCorpusList(listText([entry()]));
    expect(Object.keys(first ?? {})).toEqual([
      "name",
      "url",
      "branch",
      "commit",
      "docsPath",
    ]);
    expect(Object.isFrozen(first)).toBe(true);
  });
});
