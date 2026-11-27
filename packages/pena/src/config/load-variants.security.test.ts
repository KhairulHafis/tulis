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
import {
  MAX_VARIANTS_BYTES,
  loadVariants,
  readVariantsFile,
} from "./load-variants.js";
import { TeamFileUseError } from "./team-issue.js";

const isWindows = process.platform === "win32";
const folders: string[] = [];

function makeFolder(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "tulis-vsec-")));
  folders.push(dir);
  return dir;
}

function variantsPath(repo: string): string {
  return join(repo, ".tulis", "variants.yaml");
}

function writeVariants(repo: string, content: string | Buffer): void {
  mkdirSync(join(repo, ".tulis"), { recursive: true });
  writeFileSync(variantsPath(repo), content);
}

async function failure(repo: string): Promise<TeamFileUseError> {
  try {
    await loadVariants(repo);
  } catch (error) {
    if (error instanceof TeamFileUseError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected loadVariants to throw");
}

function everything(error: TeamFileUseError): string {
  return error.message + JSON.stringify(error.issues);
}

/** Comment lines padded so the file is exactly `size` bytes. */
function paddedFile(size: number): string {
  const line = `${"#".repeat(78)}\n`;
  let text = "version: 1\n";
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

describe("loadVariants security: size and parsing", () => {
  it("loads a file of exactly the size limit", async () => {
    const repo = makeFolder();
    const text = paddedFile(MAX_VARIANTS_BYTES);
    expect(Buffer.byteLength(text)).toBe(MAX_VARIANTS_BYTES);
    writeVariants(repo, text);
    expect((await loadVariants(repo)).source).toBe("file");
  });

  it("refuses a file over 256 KB", async () => {
    const repo = makeFolder();
    writeVariants(repo, paddedFile(MAX_VARIANTS_BYTES + 1));
    const error = await failure(repo);
    expect(error.message).toContain("larger than 256 KB");
    await expect(readVariantsFile(repo)).rejects.toBeInstanceOf(
      TeamFileUseError,
    );
  });

  it("refuses an alias bomb quickly", async () => {
    const repo = makeFolder();
    const lines = ["a: &a [x, x, x, x, x, x, x, x, x]"];
    let previous = "a";
    for (const name of "bcdefghi") {
      lines.push(
        `${name}: &${name} [${Array.from({ length: 9 }, () => `*${previous}`).join(", ")}]`,
      );
      previous = name;
    }
    writeVariants(repo, `version: 1\n${lines.join("\n")}\n`);
    const started = Date.now();
    const error = await failure(repo);
    expect(error.message).toContain("aliases");
    expect(Date.now() - started).toBeLessThan(1000);
    const file = await readVariantsFile(repo);
    expect(file.parsed).toBeUndefined();
    expect(file.writeBlocked).toBeDefined();
  });
});

describe("loadVariants security: links", () => {
  it("refuses a .tulis folder that links outside the repo", async () => {
    const repo = makeFolder();
    const outside = makeFolder();
    writeFileSync(join(outside, "variants.yaml"), "version: 1\n# TOPSECRET\n");
    symlinkSync(outside, join(repo, ".tulis"), "junction");
    const error = await failure(repo);
    expect(error.message).toContain("points outside the repository");
    expect(everything(error)).not.toContain("TOPSECRET");
  });

  it.skipIf(isWindows)(
    "refuses a variants file that links outside the repo",
    async () => {
      const repo = makeFolder();
      const outside = makeFolder();
      writeFileSync(join(outside, "secret.yaml"), "TOPSECRET: [\n");
      mkdirSync(join(repo, ".tulis"));
      symlinkSync(join(outside, "secret.yaml"), variantsPath(repo));
      const error = await failure(repo);
      expect(error.message).toContain("points outside the repository");
      expect(everything(error)).not.toContain("TOPSECRET");
    },
  );
});

describe("loadVariants security: messages", () => {
  it("never puts file values in a message", async () => {
    const repo = makeFolder();
    writeVariants(
      repo,
      [
        "version: 1",
        "groups:",
        '  - id: "TOPSECRET\\e[31m"',
        "    kind: TOPSECRET",
        '    variants: ["TOPSECRET\\u202e", 5]',
        '    source: "TOPSECRET"',
        '    enabled: "TOPSECRET"',
        "rejected:",
        "  - variants: TOPSECRET",
        "",
      ].join("\n"),
    );
    const error = await failure(repo);
    expect(error.issues.length).toBeGreaterThan(3);
    expect(everything(error)).not.toContain("TOPSECRET");
    expect(everything(error)).not.toContain("\u001b");
  });

  it("does not repeat a 10,000-character word", async () => {
    const repo = makeFolder();
    const word = "Z".repeat(10_000);
    writeVariants(
      repo,
      `version: 1\ngroups:\n  - id: a\n    kind: synonym\n    variants: ["${word}", "b"]\n`,
    );
    const error = await failure(repo);
    expect(error.issues).toHaveLength(1);
    expect(everything(error)).not.toContain("ZZZZZZZZZZ");
    expect(error.message.length).toBeLessThan(500);
  });

  it("a long unknown key name is shortened", async () => {
    const repo = makeFolder();
    writeVariants(repo, `version: 1\n${"K".repeat(900)}: 1\n`);
    const result = await loadVariants(repo);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.length).toBeLessThan(500);
  });
});
