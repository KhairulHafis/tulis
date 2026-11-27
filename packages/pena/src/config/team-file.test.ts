import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
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

function makeRepo(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "tulis-team-")));
  folders.push(dir);
  return dir;
}

function put(repo: string, rel: readonly string[], content: string): void {
  mkdirSync(join(repo, ".tulis", ...rel.slice(0, -1)), { recursive: true });
  writeFileSync(join(repo, ".tulis", ...rel), content);
}

function allNames(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" });
}

async function reasonOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as TeamFileError).reason;
  }
  throw new Error("expected a TeamFileError");
}

afterEach(() => {
  for (const dir of folders.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("readTeamFile", () => {
  it("reads a file", async () => {
    const repo = makeRepo();
    put(repo, ["decisions", "a.yaml"], "hello: 1\n");
    expect(await readTeamFile(repo, ["decisions", "a.yaml"], MAX)).toEqual({
      kind: "text",
      text: "hello: 1\n",
    });
  });

  // A write must be able to put the byte order mark back, so reading keeps it.
  it("keeps a byte order mark in the text", async () => {
    const repo = makeRepo();
    const bom = "﻿";
    put(repo, ["a.yaml"], `${bom}hello: 1\n`);
    expect(await readTeamFile(repo, ["a.yaml"], MAX)).toEqual({
      kind: "text",
      text: `${bom}hello: 1\n`,
    });
  });

  it("gives missing for a missing file and a missing .tulis", async () => {
    const repo = makeRepo();
    expect(await readTeamFile(repo, ["a.yaml"], MAX)).toEqual({
      kind: "missing",
    });
    mkdirSync(join(repo, ".tulis"));
    expect(await readTeamFile(repo, ["a.yaml"], MAX)).toEqual({
      kind: "missing",
    });
  });

  it("builds the size text from maxBytes", async () => {
    const repo = makeRepo();
    put(repo, ["a.yaml"], "x".repeat(2049));
    expect(await reasonOf(readTeamFile(repo, ["a.yaml"], 2048))).toBe(
      "The file is larger than 2 KB.",
    );
  });

  it("refuses text that is not UTF-8", async () => {
    const repo = makeRepo();
    mkdirSync(join(repo, ".tulis"));
    writeFileSync(join(repo, ".tulis", "a.yaml"), Buffer.from([0xff, 0xfe]));
    expect(await reasonOf(readTeamFile(repo, ["a.yaml"], MAX))).toBe(
      "The file is not valid UTF-8 text.",
    );
  });
});

describe("listTeamFiles", () => {
  it("returns sorted names with the extension, skipping the rest", async () => {
    const repo = makeRepo();
    put(repo, ["decisions", "b.yaml"], "");
    put(repo, ["decisions", "a.yaml"], "");
    put(repo, ["decisions", "c.txt"], "");
    mkdirSync(join(repo, ".tulis", "decisions", "sub.yaml"));
    const names = await listTeamFiles(repo, ["decisions"], {
      extension: ".yaml",
      maxFiles: 10,
    });
    expect(names).toEqual(["a.yaml", "b.yaml"]);
  });

  it("gives [] for a missing folder", async () => {
    const repo = makeRepo();
    const names = await listTeamFiles(repo, ["decisions"], {
      extension: ".yaml",
      maxFiles: 10,
    });
    expect(names).toEqual([]);
  });

  it("refuses more than maxFiles names", async () => {
    const repo = makeRepo();
    put(repo, ["decisions", "a.yaml"], "");
    put(repo, ["decisions", "b.yaml"], "");
    const reason = await reasonOf(
      listTeamFiles(repo, ["decisions"], { extension: ".yaml", maxFiles: 1 }),
    );
    expect(reason).toBe("The folder has more than 1 files.");
  });
});

describe("writeTeamFile", () => {
  it("creates .tulis and decisions on the first write", async () => {
    const repo = makeRepo();
    await writeTeamFile(repo, ["decisions", "k.yaml"], "a: 1\n", {
      maxBytes: MAX,
      expected: null,
    });
    expect(
      readFileSync(join(repo, ".tulis", "decisions", "k.yaml"), "utf8"),
    ).toBe("a: 1\n");
    expect(allNames(repo).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("replaces an existing file and keeps its permission bits", async () => {
    const repo = makeRepo();
    put(repo, ["variants.yaml"], "old\n");
    const file = join(repo, ".tulis", "variants.yaml");
    chmodSync(file, 0o600);
    await writeTeamFile(repo, ["variants.yaml"], "new\n", {
      maxBytes: MAX,
      expected: "old\n",
    });
    expect(readFileSync(file, "utf8")).toBe("new\n");
    if (!isWindows) {
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
    expect(allNames(repo).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("refuses when the file changed, appeared or was deleted", async () => {
    const repo = makeRepo();
    const mismatch =
      "The file changed while Tulis was editing it. Please try again.";
    const file = join(repo, ".tulis", "v.yaml");

    put(repo, ["v.yaml"], "changed\n");
    expect(
      await reasonOf(
        writeTeamFile(repo, ["v.yaml"], "x", {
          maxBytes: MAX,
          expected: "old\n",
        }),
      ),
    ).toBe(mismatch);
    expect(readFileSync(file, "utf8")).toBe("changed\n");

    expect(
      await reasonOf(
        writeTeamFile(repo, ["v.yaml"], "x", { maxBytes: MAX, expected: null }),
      ),
    ).toBe(mismatch);
    expect(readFileSync(file, "utf8")).toBe("changed\n");

    rmSync(file);
    expect(
      await reasonOf(
        writeTeamFile(repo, ["v.yaml"], "x", {
          maxBytes: MAX,
          expected: "changed\n",
        }),
      ),
    ).toBe(mismatch);
    expect(allNames(repo).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("creates nothing when the expected text cannot match", async () => {
    const repo = makeRepo();
    await reasonOf(
      writeTeamFile(repo, ["decisions", "k.yaml"], "x", {
        maxBytes: MAX,
        expected: "something",
      }),
    );
    expect(allNames(repo)).toEqual([]);
  });

  it("refuses text over maxBytes", async () => {
    const repo = makeRepo();
    const reason = await reasonOf(
      writeTeamFile(repo, ["v.yaml"], "x".repeat(MAX + 1), {
        maxBytes: MAX,
        expected: null,
      }),
    );
    expect(reason).toBe("The text is larger than 1 KB, so it was not written.");
    expect(allNames(repo)).toEqual([]);
  });
});
