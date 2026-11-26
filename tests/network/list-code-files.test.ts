import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listCodeFiles } from "./list-code-files.js";

const folders: string[] = [];

function makeTempFolder(): string {
  const folder = mkdtempSync(join(tmpdir(), "tulis-"));
  folders.push(folder);
  return folder;
}

afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
});

describe("listCodeFiles", () => {
  it("lists code files, skips ignored folders and does not follow links", () => {
    const root = makeTempFolder();
    const outside = makeTempFolder();
    writeFileSync(join(outside, "outside.ts"), "");
    for (const dir of ["sub", "node_modules", "dist", ".git"]) {
      mkdirSync(join(root, dir));
    }
    writeFileSync(join(root, "a.ts"), "");
    writeFileSync(join(root, "sub", "b.mjs"), "");
    writeFileSync(join(root, "notes.md"), "");
    writeFileSync(join(root, "node_modules", "x.js"), "");
    writeFileSync(join(root, "dist", "y.js"), "");
    writeFileSync(join(root, ".git", "z.js"), "");
    symlinkSync(outside, join(root, "linked"), "junction");

    expect(listCodeFiles(root)).toEqual(["a.ts", "sub/b.mjs"]);
  });
});
