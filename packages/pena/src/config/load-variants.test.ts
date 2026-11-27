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
import { TeamFileUseError } from "./team-issue.js";
import {
  VARIANTS_FILE,
  loadVariants,
  readVariantsFile,
} from "./load-variants.js";
import { EMPTY_TEAM_VARIANTS } from "./variants-types.js";

const folders: string[] = [];

function makeRepo(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "tulis-var-")));
  folders.push(dir);
  return dir;
}

function writeVariants(repo: string, content: string): void {
  mkdirSync(join(repo, ".tulis"), { recursive: true });
  writeFileSync(join(repo, ".tulis", "variants.yaml"), content);
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

afterEach(() => {
  for (const dir of folders.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const VALID = `version: 1
groups:
  - id: sign-in
    kind: synonym
    variants: ["log in", "sign in"]
  - id: login-form
    enabled: false
rejected:
  - variants: ["open", "close"]
`;

describe("loadVariants", () => {
  it("gives empty variants when there is no file", async () => {
    const result = await loadVariants(makeRepo());
    expect(result).toEqual({
      variants: EMPTY_TEAM_VARIANTS,
      source: "none",
      warnings: [],
    });
    expect(result.variants).toBe(EMPTY_TEAM_VARIANTS);
  });

  it("loads a valid file", async () => {
    const repo = makeRepo();
    writeVariants(repo, VALID);
    const result = await loadVariants(repo);
    expect(result.source).toBe("file");
    expect(result.warnings).toEqual([]);
    expect(result.variants.groups).toHaveLength(1);
    expect(result.variants.disabled).toEqual(["login-form"]);
    expect(result.variants.rejected).toEqual([{ variants: ["open", "close"] }]);
  });

  it("an empty file loads with no warnings", async () => {
    const repo = makeRepo();
    writeVariants(repo, "# nothing yet\n");
    const result = await loadVariants(repo);
    expect(result).toEqual({
      variants: EMPTY_TEAM_VARIANTS,
      source: "file",
      warnings: [],
    });
  });

  it("returns formatted warnings", async () => {
    const repo = makeRepo();
    writeVariants(repo, "groups: []\nrejcted: []\n");
    const result = await loadVariants(repo);
    expect(result.warnings).toEqual([
      `${VARIANTS_FILE} line 2: Unknown key "rejcted" is ignored. Did you mean "rejected"?`,
      `${VARIANTS_FILE}: No version line, so the file is read as version 1. Add \`version: 1\` at the top.`,
    ]);
  });

  it("throws TeamFileUseError with formatted messages for errors", async () => {
    const repo = makeRepo();
    writeVariants(
      repo,
      "version: 1\ngroups:\n  - id: Bad\n    kind: synonym\n    variants: [a, b]\n    varients: x\n",
    );
    const error = await failure(repo);
    expect(error).toBeInstanceOf(TeamFileUseError);
    expect(error.file).toBe(VARIANTS_FILE);
    expect(error.issues).toHaveLength(1);
    expect(error.warnings).toHaveLength(1);
    expect(error.message).toContain(`${VARIANTS_FILE} line 3: groups[1].id`);
    expect(error.message).toContain(`${VARIANTS_FILE} line 6: Unknown key`);
  });

  it("throws with the line for invalid YAML", async () => {
    const repo = makeRepo();
    writeVariants(repo, "version: 1\ngroups: [\n");
    const error = await failure(repo);
    expect(error.file).toBe(VARIANTS_FILE);
    expect(error.message).toContain("Not valid YAML");
    expect(error.issues[0]?.line).toBeDefined();
  });

  it("throws when the file is a folder", async () => {
    const repo = makeRepo();
    mkdirSync(join(repo, ".tulis", "variants.yaml"), { recursive: true });
    const error = await failure(repo);
    expect(error.file).toBe(VARIANTS_FILE);
    expect(error.message).toContain("not a regular file");
  });

  it("a newer version returns entries and exactly one warning", async () => {
    const repo = makeRepo();
    writeVariants(
      repo,
      "# note\nversion: 2\nfuture: 1\ngroups:\n  - id: sign-in\n    kind: synonym\n    variants: [a, b]\n  - id: Bad\n",
    );
    const result = await loadVariants(repo);
    expect(result.source).toBe("file");
    expect(result.variants.groups).toHaveLength(1);
    expect(result.warnings).toEqual([
      `${VARIANTS_FILE} line 2: This file was made by a newer version of Tulis (file version 2). Please upgrade Tulis. Entries this version can't use are skipped.`,
    ]);
  });
});

describe("readVariantsFile", () => {
  it("a missing file can be created", async () => {
    const file = await readVariantsFile(makeRepo());
    expect(file.text).toBeNull();
    expect(file.parsed).toBeUndefined();
    expect(file.check.errors).toEqual([]);
    expect(file.check.variants).toBe(EMPTY_TEAM_VARIANTS);
    expect(file.writeBlocked).toBeUndefined();
  });

  it("a clean file returns text and the parsed document", async () => {
    const repo = makeRepo();
    writeVariants(repo, VALID);
    const file = await readVariantsFile(repo);
    expect(file.text).toBe(VALID);
    expect(file.parsed?.document.toString()).toContain("sign-in");
    expect(file.parsed?.lineEnding).toBe("\n");
    expect(file.check.errors).toEqual([]);
    expect(file.writeBlocked).toBeUndefined();
  });

  it("invalid YAML is not thrown and blocks writing", async () => {
    const repo = makeRepo();
    writeVariants(repo, "groups: [\n");
    const file = await readVariantsFile(repo);
    expect(file.parsed).toBeUndefined();
    expect(file.text).toBe("groups: [\n");
    expect(file.check.errors).toHaveLength(1);
    expect(file.check.errors[0]?.message).toMatch(/^Not valid YAML: /);
    expect(file.writeBlocked).toBe(
      "The file is not valid YAML, so Tulis won't change it.",
    );
  });

  it("errors block writing", async () => {
    const repo = makeRepo();
    writeVariants(repo, "version: 1\ngroups:\n  - id: Bad\n");
    const file = await readVariantsFile(repo);
    expect(file.parsed).toBeDefined();
    expect(file.writeBlocked).toBe(
      "The file has errors, so Tulis won't change it. Fix them first.",
    );
  });

  it("a newer version blocks writing", async () => {
    const repo = makeRepo();
    writeVariants(repo, "version: 3\ngroups:\n  - id: Bad\n");
    const file = await readVariantsFile(repo);
    expect(file.writeBlocked).toBe(
      "The file was made by a newer version of Tulis, so this version won't change it. Please upgrade Tulis.",
    );
  });

  it("warnings alone do not block writing", async () => {
    const repo = makeRepo();
    writeVariants(repo, "groups: []\n");
    const file = await readVariantsFile(repo);
    expect(file.check.warnings).toHaveLength(1);
    expect(file.writeBlocked).toBeUndefined();
  });

  it("a read failure throws TeamFileUseError", async () => {
    const repo = makeRepo();
    mkdirSync(join(repo, ".tulis", "variants.yaml"), { recursive: true });
    await expect(readVariantsFile(repo)).rejects.toBeInstanceOf(
      TeamFileUseError,
    );
  });
});

describe("exports", () => {
  it("are available from the package index", () => {
    expect(pena.loadVariants).toBe(loadVariants);
    expect(pena.readVariantsFile).toBe(readVariantsFile);
    expect(pena.VARIANTS_FILE).toBe(VARIANTS_FILE);
    expect(pena.EMPTY_TEAM_VARIANTS).toBe(EMPTY_TEAM_VARIANTS);
    expect(pena.rejectedKey(["B", "a"])).toBe("a\nb");
    expect(typeof pena.checkVariants).toBe("function");
  });
});
