import { createHash } from "node:crypto";

const MAX_INPUT_LENGTH = 1000;
const MAX_BASE_LENGTH = 64;
const FILE_EXTENSION = ".yaml";
const BASE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Letters that do not break into a base letter plus an accent. */
const SPECIAL_LETTERS: ReadonlyMap<string, string> = new Map([
  ["ß", "ss"],
  ["æ", "ae"],
  ["Æ", "ae"],
  ["ø", "o"],
  ["Ø", "o"],
  ["œ", "oe"],
  ["Œ", "oe"],
  ["đ", "d"],
  ["Đ", "d"],
  ["ł", "l"],
  ["Ł", "l"],
  ["þ", "th"],
  ["Þ", "th"],
  ["ı", "i"],
]);

const RESERVED_NAMES: ReadonlySet<string> = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_, i) => `com${String(i + 1)}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${String(i + 1)}`),
]);

function mapSpecialLetters(text: string): string {
  let result = "";
  for (const letter of text) {
    result += SPECIAL_LETTERS.get(letter) ?? letter;
  }
  return result;
}

function trimHyphens(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && text.charAt(start) === "-") {
    start += 1;
  }
  while (end > start && text.charAt(end - 1) === "-") {
    end -= 1;
  }
  return text.slice(start, end);
}

/** "khairul-hafis.yaml" for "Khairul Hafis". undefined when the name is empty or only whitespace. */
export function decisionsFileName(writerName: string): string | undefined {
  const name = writerName.trim().slice(0, MAX_INPUT_LENGTH);
  if (name === "") {
    return undefined;
  }

  const letters = mapSpecialLetters(name)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  let base = trimHyphens(letters.replace(/[^a-z0-9]+/g, "-"));
  base = trimHyphens(base.slice(0, MAX_BASE_LENGTH));

  if (base === "") {
    const digest = createHash("sha256")
      .update(name.normalize("NFC"), "utf8")
      .digest("hex");
    base = `writer-${digest.slice(0, 8)}`;
  }
  if (RESERVED_NAMES.has(base)) {
    base += "-writer";
  }
  return base + FILE_EXTENSION;
}

/** True for names this module could have produced: ^[a-z0-9]+(?:-[a-z0-9]+)*\.yaml$, base at most 64 characters. */
export function isDecisionsFileName(fileName: string): boolean {
  if (!fileName.endsWith(FILE_EXTENSION)) {
    return false;
  }
  const base = fileName.slice(0, -FILE_EXTENSION.length);
  return base.length <= MAX_BASE_LENGTH && BASE_PATTERN.test(base);
}
