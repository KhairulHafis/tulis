import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listTeamFiles, readTeamFile, writeTeamFile } from "./team-file.js";
import type { TeamFileError } from "./team-file.js";

const isWindows = process.platform === "win32";
const folders: string[] = [];
const MAX = 1024;

function makeFolder(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "tulis-tsec-")));
  folders.push(dir);
  return dir;
}

async function reasonOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as TeamFileError).reason;
  }
  throw new Error("expected a TeamFileError");
}

function write(repo: string, path: readonly string[]): Promise<void> {
  return writeTeamFile(repo, path, "NEW\n", { maxBytes: MAX, expected: null });
}

afterEach(() => {
  for (const dir of folders.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("team file links", () => {
  it("refuses to write through a .tulis link", async () => {
    const repo = makeFolder();
    const outside = makeFolder();
    symlinkSync(outside, join(repo, ".tulis"), "junction");

    // Control: a plain write follows the link.
    writeFileSync(join(repo, ".tulis", "control.yaml"), "x");
    expect(readdirSync(outside)).toEqual(["control.yaml"]);
    rmSync(join(outside, "control.yaml"));

    await reasonOf(write(repo, ["variants.yaml"]));
    await reasonOf(write(repo, ["decisions", "a.yaml"]));
    expect(readdirSync(outside)).toEqual([]);
  });

  it("refuses to write or list through a decisions link", async () => {
    const repo = makeFolder();
    const outside = makeFolder();
    mkdirSync(join(repo, ".tulis"));
    symlinkSync(outside, join(repo, ".tulis", "decisions"), "junction");
    writeFileSync(join(outside, "x.yaml"), "x");

    // Control: a plain write follows the link.
    writeFileSync(join(repo, ".tulis", "decisions", "control.yaml"), "x");
    expect(readdirSync(outside).sort()).toEqual(["control.yaml", "x.yaml"]);
    rmSync(join(outside, "control.yaml"));

    await reasonOf(write(repo, ["decisions", "a.yaml"]));
    expect(readdirSync(outside)).toEqual(["x.yaml"]);
    await reasonOf(
      listTeamFiles(repo, ["decisions"], { extension: ".yaml", maxFiles: 10 }),
    );
  });

  it.skipIf(isWindows)(
    "refuses to write through a target symlink",
    async () => {
      const repo = makeFolder();
      const outside = makeFolder();
      const secret = join(outside, "secret.yaml");
      writeFileSync(secret, "ORIGINAL");
      mkdirSync(join(repo, ".tulis"));
      const link = join(repo, ".tulis", "variants.yaml");
      symlinkSync(secret, link);

      // Control: a plain write follows the link.
      writeFileSync(link, "CHANGED");
      expect(readFileSync(secret, "utf8")).toBe("CHANGED");
      writeFileSync(secret, "ORIGINAL");

      await reasonOf(
        writeTeamFile(repo, ["variants.yaml"], "NEW\n", {
          maxBytes: MAX,
          expected: "ORIGINAL",
        }),
      );
      expect(readFileSync(secret, "utf8")).toBe("ORIGINAL");
    },
  );

  // Reading follows a link that stays inside the repo, so only the writer's own
  // lstat check can refuse this one.
  it.skipIf(isWindows)(
    "refuses to write through a target symlink that stays inside the repo",
    async () => {
      const repo = makeFolder();
      const doc = join(repo, "docs", "page.md");
      mkdirSync(join(repo, "docs"));
      writeFileSync(doc, "ORIGINAL");
      mkdirSync(join(repo, ".tulis"));
      symlinkSync(doc, join(repo, ".tulis", "variants.yaml"));

      expect(
        await reasonOf(
          writeTeamFile(repo, ["variants.yaml"], "NEW\n", {
            maxBytes: MAX,
            expected: "ORIGINAL",
          }),
        ),
      ).toBe("The file is not a regular file.");
      expect(readFileSync(doc, "utf8")).toBe("ORIGINAL");
    },
  );

  it("refuses when the target is a folder", async () => {
    const repo = makeFolder();
    mkdirSync(join(repo, ".tulis", "variants.yaml"), { recursive: true });
    expect(await reasonOf(write(repo, ["variants.yaml"]))).toBe(
      "The file is not a regular file.",
    );
    expect(readdirSync(join(repo, ".tulis"))).toEqual(["variants.yaml"]);
  });

  it("leaves a link entry out of a listing", async () => {
    const repo = makeFolder();
    const outside = makeFolder();
    mkdirSync(join(repo, ".tulis", "decisions"), { recursive: true });
    writeFileSync(join(repo, ".tulis", "decisions", "a.yaml"), "a");
    writeFileSync(join(outside, "evil.yaml"), "evil");
    symlinkSync(
      outside,
      join(repo, ".tulis", "decisions", "dir.yaml"),
      "junction",
    );
    if (!isWindows) {
      symlinkSync(
        join(outside, "evil.yaml"),
        join(repo, ".tulis", "decisions", "evil.yaml"),
      );
    }
    const names = await listTeamFiles(repo, ["decisions"], {
      extension: ".yaml",
      maxFiles: 10,
    });
    expect(names).toEqual(["a.yaml"]);
  });

  it("refuses to read a link that resolves outside", async () => {
    const repo = makeFolder();
    const outside = makeFolder();
    writeFileSync(join(outside, "a.yaml"), "TOPSECRET");
    mkdirSync(join(repo, ".tulis"));
    symlinkSync(outside, join(repo, ".tulis", "decisions"), "junction");
    const reason = await reasonOf(
      readTeamFile(repo, ["decisions", "a.yaml"], MAX),
    );
    expect(reason).toBe(
      "The file points outside the repository, so it was not read.",
    );
    expect(reason).not.toContain("TOPSECRET");
  });

  it("reads a link that resolves inside the repo", async () => {
    const repo = makeFolder();
    mkdirSync(join(repo, "real"));
    writeFileSync(join(repo, "real", "a.yaml"), "inside");
    mkdirSync(join(repo, ".tulis"));
    symlinkSync(join(repo, "real"), join(repo, ".tulis", "d"), "junction");
    expect(await readTeamFile(repo, ["d", "a.yaml"], MAX)).toEqual({
      kind: "text",
      text: "inside",
    });
  });
});

describe("team path names", () => {
  const bad = [
    "..",
    ".",
    "a/b",
    "a\\b",
    "",
    "a\u0000b",
    "a\nb",
    "x".repeat(256),
  ];

  it.each(bad)("rejects %j before touching the disk", async (name) => {
    const missing = join(makeFolder(), "does-not-exist");
    const options = { maxBytes: MAX, expected: null };
    await reasonOf(writeTeamFile(missing, [name], "x", options));
    await reasonOf(writeTeamFile(missing, ["decisions", name], "x", options));
    await reasonOf(readTeamFile(missing, [name], MAX));
    await reasonOf(
      listTeamFiles(missing, [name], { extension: "", maxFiles: 1 }),
    );
    // A disk access would have said the repository could not be opened.
    expect(await reasonOf(readTeamFile(missing, [name], MAX))).toBe(
      "The file name is not allowed.",
    );
  });
});
