import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigError, MAX_CONFIG_BYTES, loadConfig } from "./load-config.js";

const isWindows = process.platform === "win32";
const folders: string[] = [];

function makeFolder(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "tulis-sec-")));
  folders.push(dir);
  return dir;
}

function configPath(repo: string): string {
  return join(repo, ".tulis", "config.yaml");
}

function writeConfig(repo: string, content: string | Buffer): void {
  mkdirSync(join(repo, ".tulis"), { recursive: true });
  writeFileSync(configPath(repo), content);
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

function expectNoLeak(error: ConfigError): void {
  const everything = error.message + JSON.stringify(error.issues);
  expect(everything).not.toContain("TOPSECRET");
  expect(everything).not.toContain("\u001b");
}

/** Comment lines padded so the file is exactly `size` bytes. */
function paddedFile(size: number): string {
  const head = "version: 1\n";
  const line = `${"#".repeat(78)}\n`;
  let text = head;
  while (text.length + line.length <= size) {
    text += line;
  }
  const rest = size - text.length;
  if (rest > 0) {
    text += rest === 1 ? "\n" : `${"#".repeat(rest - 1)}\n`;
  }
  return text;
}

afterEach(() => {
  for (const dir of folders.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("loadConfig security: links", () => {
  it("refuses a .tulis folder that links outside the repo", async () => {
    const repo = makeFolder();
    const outside = makeFolder();
    writeFileSync(join(outside, "config.yaml"), "version: 1\n# TOPSECRET\n");
    symlinkSync(outside, join(repo, ".tulis"), "junction");
    const error = await failure(repo);
    expect(error.message).toContain("points outside the repository");
    expectNoLeak(error);
  });

  it.skipIf(isWindows)(
    "refuses a config file that links outside the repo",
    async () => {
      const repo = makeFolder();
      const outside = makeFolder();
      writeFileSync(join(outside, "secret.yaml"), "TOPSECRET: [\n");
      mkdirSync(join(repo, ".tulis"));
      symlinkSync(join(outside, "secret.yaml"), configPath(repo));
      const error = await failure(repo);
      expect(error.message).toContain("points outside the repository");
      expectNoLeak(error);
    },
  );

  it.skipIf(isWindows)("reads a link that stays inside the repo", async () => {
    const repo = makeFolder();
    mkdirSync(join(repo, "settings"));
    mkdirSync(join(repo, ".tulis"));
    writeFileSync(
      join(repo, "settings", "team.yaml"),
      "version: 1\nminDocs: 9\n",
    );
    symlinkSync(join(repo, "settings", "team.yaml"), configPath(repo));
    const result = await loadConfig(repo);
    expect(result.source).toBe("file");
    expect(result.config.minDocs).toBe(9);
  });

  it.skipIf(isWindows)("refuses a link loop", async () => {
    const repo = makeFolder();
    mkdirSync(join(repo, ".tulis"));
    symlinkSync(configPath(repo), configPath(repo));
    const error = await failure(repo);
    expect(error.message).toContain("could not be read");
  });
});

describe("loadConfig security: special files", () => {
  it("refuses a folder named config.yaml", async () => {
    const repo = makeFolder();
    mkdirSync(configPath(repo), { recursive: true });
    const error = await failure(repo);
    expect(error.message).toContain("not a regular file");
  });

  it.skipIf(isWindows)(
    "refuses a FIFO without hanging",
    async () => {
      const repo = makeFolder();
      mkdirSync(join(repo, ".tulis"));
      execFileSync("mkfifo", [configPath(repo)]);
      const started = Date.now();
      const error = await failure(repo);
      expect(error.message).toContain("not a regular file");
      expect(Date.now() - started).toBeLessThan(2000);
    },
    5000,
  );
});

describe("loadConfig security: size and text", () => {
  it("loads a file of exactly the size limit", async () => {
    const repo = makeFolder();
    const text = paddedFile(MAX_CONFIG_BYTES);
    expect(Buffer.byteLength(text)).toBe(MAX_CONFIG_BYTES);
    writeConfig(repo, text);
    const result = await loadConfig(repo);
    expect(result.source).toBe("file");
  });

  it("refuses a file one byte over the limit", async () => {
    const repo = makeFolder();
    writeConfig(repo, paddedFile(MAX_CONFIG_BYTES + 1));
    const error = await failure(repo);
    expect(error.message).toContain("larger than 64 KB");
  });

  it("refuses bytes that are not UTF-8", async () => {
    const repo = makeFolder();
    writeConfig(repo, Buffer.from([0x76, 0x3a, 0xff, 0x0a]));
    const error = await failure(repo);
    expect(error.message).toContain("not valid UTF-8");
  });

  it("stops an alias bomb quickly", async () => {
    const repo = makeFolder();
    const lines = ["a: &a [x, x, x, x, x, x, x, x, x]"];
    let previous = "a";
    for (const name of "bcdefghi") {
      lines.push(
        `${name}: &${name} [${Array.from({ length: 9 }, () => `*${previous}`).join(", ")}]`,
      );
      previous = name;
    }
    writeConfig(repo, `version: 1\n${lines.join("\n")}\n`);
    const started = Date.now();
    const error = await failure(repo);
    expect(error.message).toContain("aliases");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("never puts file values in a message", async () => {
    const repo = makeFolder();
    writeConfig(
      repo,
      'version: 1\nthreshold: "TOPSECRET\\e[31m"\nprodBranch: "TOPSECRET\\e[31m"\n',
    );
    const error = await failure(repo);
    expectNoLeak(error);
  });
});
