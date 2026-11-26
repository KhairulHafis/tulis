import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as pena from "../index.js";
import { DEFAULT_CONFIG } from "./config-defaults.js";
import {
  CONFIG_FILE,
  ConfigError,
  formatIssue,
  loadConfig,
} from "./load-config.js";

const folders: string[] = [];

function makeRepo(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "tulis-cfg-")));
  folders.push(dir);
  return dir;
}

function writeConfig(repo: string, content: string | Buffer): void {
  mkdirSync(join(repo, ".tulis"), { recursive: true });
  writeFileSync(join(repo, ".tulis", "config.yaml"), content);
}

async function failure(repo: string): Promise<ConfigError> {
  try {
    await loadConfig(repo);
  } catch (error) {
    if (error instanceof ConfigError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected loadConfig to throw");
}

afterEach(() => {
  for (const dir of folders.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("loadConfig: no file", () => {
  it("gives defaults when there is no .tulis folder", async () => {
    const result = await loadConfig(makeRepo());
    expect(result).toEqual({
      config: DEFAULT_CONFIG,
      source: "defaults",
      warnings: [],
    });
  });

  it("gives defaults when .tulis has no config.yaml", async () => {
    const repo = makeRepo();
    mkdirSync(join(repo, ".tulis"));
    const result = await loadConfig(repo);
    expect(result.source).toBe("defaults");
    expect(result.config).toBe(DEFAULT_CONFIG);
    expect(result.warnings).toEqual([]);
  });

  it("gives defaults when .tulis is a regular file", async () => {
    const repo = makeRepo();
    writeFileSync(join(repo, ".tulis"), "x");
    const result = await loadConfig(repo);
    expect(result.source).toBe("defaults");
    expect(result.warnings).toEqual([]);
  });
});

describe("loadConfig: a file", () => {
  it("reads a valid file", async () => {
    const repo = makeRepo();
    writeConfig(repo, "version: 1\nthreshold: 0.7\nminDocs: 4\n");
    const result = await loadConfig(repo);
    expect(result.source).toBe("file");
    expect(result.config.threshold).toBe(0.7);
    expect(result.config.minDocs).toBe(4);
    expect(result.warnings).toEqual([]);
  });

  it("warns about an empty file", async () => {
    const repo = makeRepo();
    writeConfig(repo, "");
    const result = await loadConfig(repo);
    expect(result.source).toBe("file");
    expect(result.config).toEqual(DEFAULT_CONFIG);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(
      /^\.tulis\/config\.yaml: No version line, /,
    );
  });

  it("warns about an unknown key with its line", async () => {
    const repo = makeRepo();
    writeConfig(repo, "version: 1\nminDocs: 3\nthresold: 0.7\n");
    const result = await loadConfig(repo);
    expect(result.warnings).toEqual([
      '.tulis/config.yaml line 3: Unknown key "thresold" is ignored. Did you mean "threshold"?',
    ]);
  });

  it("throws one ConfigError listing every bad value", async () => {
    const repo = makeRepo();
    writeConfig(repo, "version: 1\nthreshold: 5\nminDocs: -2\n");
    const error = await failure(repo);
    expect(error.name).toBe("ConfigError");
    expect(error.issues).toHaveLength(2);
    const lines = error.message.split("\n");
    expect(lines[0]).toBe("Could not use .tulis/config.yaml.");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(/^ {2}\.tulis\/config\.yaml line 2: /);
    expect(lines[2]).toMatch(/^ {2}\.tulis\/config\.yaml line 3: /);
    expect(error.warnings).toEqual([]);
  });

  it("lists warnings after the errors, since a typo often explains one", async () => {
    const repo = makeRepo();
    writeConfig(repo, "version: 1\nthresold: 0.9\nminDocs: -2\n");
    const error = await failure(repo);
    expect(error.issues).toHaveLength(1);
    expect(error.warnings).toHaveLength(1);
    expect(error.message.split("\n")).toEqual([
      "Could not use .tulis/config.yaml.",
      "  .tulis/config.yaml line 3: minDocs must be a whole number from 1 to 1000000.",
      '  .tulis/config.yaml line 2: Unknown key "thresold" is ignored. Did you mean "threshold"?',
    ]);
  });

  it("throws on a YAML syntax error with the line", async () => {
    const repo = makeRepo();
    writeConfig(repo, "version: 1\nthreshold: [1, 2\nminDocs: 3\n");
    const error = await failure(repo);
    expect(error.issues).toHaveLength(1);
    expect(error.issues[0]?.line).toBeTypeOf("number");
    expect(error.issues[0]?.message).toMatch(/^Not valid YAML: /);
  });

  it("only warns once for a newer version and uses what it can", async () => {
    const repo = makeRepo();
    writeConfig(
      repo,
      "# comment\nversion: 2\nthreshold: 9\nminDocs: 7\nfuture: true\n",
    );
    const result = await loadConfig(repo);
    expect(result.source).toBe("file");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(
      /^\.tulis\/config\.yaml line 2: This file was made by a newer version of Tulis \(file version 2\)\./,
    );
    expect(result.config.threshold).toBe(DEFAULT_CONFIG.threshold);
    expect(result.config.minDocs).toBe(7);
  });

  it("still throws on YAML syntax errors in a newer version", async () => {
    const repo = makeRepo();
    writeConfig(repo, "version: 2\nthreshold: [1, 2\n");
    const error = await failure(repo);
    expect(error.issues[0]?.message).toMatch(/^Not valid YAML: /);
  });

  const body = "version: 1\nthreshold: 0.7\nthresold: 1\nminDocs: 4\n";
  it("gives the same result with CRLF line endings", async () => {
    const repo = makeRepo();
    writeConfig(repo, body.replace(/\n/g, "\r\n"));
    const result = await loadConfig(repo);
    expect(result.config.minDocs).toBe(4);
    expect(result.warnings).toEqual([
      '.tulis/config.yaml line 3: Unknown key "thresold" is ignored. Did you mean "threshold"?',
    ]);
  });

  it("gives the same result with a UTF-8 BOM", async () => {
    const repo = makeRepo();
    writeConfig(
      repo,
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(body)]),
    );
    const result = await loadConfig(repo);
    expect(result.config.minDocs).toBe(4);
    expect(result.warnings).toEqual([
      '.tulis/config.yaml line 3: Unknown key "thresold" is ignored. Did you mean "threshold"?',
    ]);
  });
});

describe("loadConfig: the repo folder", () => {
  it("throws when the repo folder is missing", async () => {
    const repo = makeRepo();
    const error = await failure(join(repo, "missing"));
    expect(error.issues).toEqual([
      {
        key: "",
        line: undefined,
        message: "The repository folder could not be opened.",
      },
    ]);
    expect(error.message).not.toContain(repo);
  });
});

describe("formatIssue", () => {
  it("includes the line when there is one", () => {
    expect(formatIssue({ key: "a", line: 4, message: "Bad." })).toBe(
      ".tulis/config.yaml line 4: Bad.",
    );
  });

  it("leaves the line out when there is none", () => {
    expect(formatIssue({ key: "a", line: undefined, message: "Bad." })).toBe(
      ".tulis/config.yaml: Bad.",
    );
    expect(CONFIG_FILE).toBe(".tulis/config.yaml");
  });
});

describe("exports", () => {
  it("exposes the config API from the package entry", () => {
    expect(pena.loadConfig).toBe(loadConfig);
    expect(pena.ConfigError).toBe(ConfigError);
    expect(pena.DEFAULT_CONFIG).toBe(DEFAULT_CONFIG);
  });
});
