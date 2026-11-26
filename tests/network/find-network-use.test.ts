import { describe, expect, it } from "vitest";
import { findNetworkUse } from "./find-network-use.js";

function whatOf(fileName: string, source: string): string[] {
  return findNetworkUse(fileName, source).map((use) => use.what);
}

describe("findNetworkUse reports", () => {
  const cases: [string, string, string, string][] = [
    ["default import", "x.ts", 'import http from "http";', 'imports "http"'],
    [
      "node: default import",
      "x.ts",
      'import http from "node:http";',
      'imports "node:http"',
    ],
    [
      "named import",
      "x.ts",
      'import { request } from "https";',
      'imports "https"',
    ],
    ["namespace import", "x.ts", 'import * as n from "net";', 'imports "net"'],
    ["side-effect import", "x.ts", 'import "tls";', 'imports "tls"'],
    [
      "type-only import",
      "x.ts",
      'import type { Agent } from "node:http";',
      'imports "node:http"',
    ],
    ["export star", "x.ts", 'export * from "dgram";', 'imports "dgram"'],
    [
      "import equals",
      "x.ts",
      'import x = require("http2");',
      'imports "http2"',
    ],
    [
      "require in cjs",
      "x.cjs",
      'const h = require("node:http");',
      'imports "node:http"',
    ],
    ["dynamic import", "x.ts", 'await import("undici");', 'imports "undici"'],
    [
      "subpath require",
      "x.cjs",
      'require("dns/promises");',
      'imports "dns/promises"',
    ],
    [
      "getBuiltinModule",
      "x.ts",
      'process.getBuiltinModule("node:net");',
      'imports "node:net"',
    ],
    [
      "computed require",
      "x.cjs",
      "require(name);",
      "computed module name in require",
    ],
    [
      "computed import",
      "x.ts",
      "await import(name);",
      "computed module name in import",
    ],
    ["bare fetch", "x.ts", "fetch(url);", 'uses global "fetch"'],
    [
      "globalThis.fetch",
      "x.ts",
      "globalThis.fetch(url);",
      'uses global "fetch"',
    ],
    [
      "globalThis element access",
      "x.ts",
      'globalThis["fetch"];',
      'uses global "fetch"',
    ],
    ["new WebSocket", "x.ts", "new WebSocket(url);", 'uses global "WebSocket"'],
    [
      "createRequire",
      "x.ts",
      "const load = createRequire(import.meta.url);",
      "uses createRequire",
    ],
  ];

  it.each(cases)("%s", (_name, fileName, source, what) => {
    expect(whatOf(fileName, source)).toEqual([what]);
  });

  it("reports the exact line and column", () => {
    const source = 'const a = 1;\nconst b = 2;\n  import "http";\n';
    expect(findNetworkUse("x.ts", source)).toEqual([
      { line: 3, column: 3, what: 'imports "http"' },
    ]);
  });
});

describe("findNetworkUse ignores", () => {
  const cases: [string, string, string][] = [
    ["node:fs import", "x.ts", 'import { readFile } from "node:fs";'],
    ["http-errors", "x.ts", 'import x from "http-errors";'],
    ["network", "x.ts", 'import x from "network";'],
    ["git.fetch", "x.ts", "git.fetch();"],
    ["string literal", "x.ts", "const s = 'import http from \"http\"';"],
    ["comment", "x.ts", "// fetch the http module\nconst a = 1;"],
    ["plain tsx", "x.tsx", "const el = <div>hello</div>;"],
  ];

  it.each(cases)("%s", (_name, fileName, source) => {
    expect(findNetworkUse(fileName, source)).toEqual([]);
  });
});
