const WORD = /^[a-z]+(?:-[a-z]+)*$/;
const WHITESPACE = /\s+/gu;
const VOWELS = "aeiou";

interface IrregularVerb {
  /** Replaces the regular -ed forms. */
  readonly past: readonly string[];
  /** Replaces the regular -s form. */
  readonly third?: string;
}

function verb(past: readonly string[], third?: string): IrregularVerb {
  return third === undefined ? { past } : { past, third };
}

const IRREGULAR_VERBS: ReadonlyMap<string, IrregularVerb> = new Map([
  ["begin", verb(["began", "begun"])],
  ["break", verb(["broke", "broken"])],
  ["bring", verb(["brought"])],
  ["build", verb(["built"])],
  ["buy", verb(["bought"])],
  ["choose", verb(["chose", "chosen"])],
  ["come", verb(["came"])],
  ["cut", verb(["cut"])],
  ["do", verb(["did", "done"], "does")],
  ["draw", verb(["drew", "drawn"])],
  ["drive", verb(["drove", "driven"])],
  ["find", verb(["found"])],
  ["forget", verb(["forgot", "forgotten"])],
  ["freeze", verb(["froze", "frozen"])],
  ["get", verb(["got", "gotten"])],
  ["give", verb(["gave", "given"])],
  ["go", verb(["went", "gone"], "goes")],
  ["grow", verb(["grew", "grown"])],
  ["have", verb(["had"], "has")],
  ["hide", verb(["hid", "hidden"])],
  ["hold", verb(["held"])],
  ["keep", verb(["kept"])],
  ["know", verb(["knew", "known"])],
  ["lead", verb(["led"])],
  ["lose", verb(["lost"])],
  ["make", verb(["made"])],
  ["mean", verb(["meant"])],
  ["meet", verb(["met"])],
  ["put", verb(["put"])],
  ["read", verb(["read"])],
  ["rebuild", verb(["rebuilt"])],
  ["rerun", verb(["reran"])],
  ["reset", verb(["reset"])],
  ["rewrite", verb(["rewrote", "rewritten"])],
  ["run", verb(["ran"])],
  ["say", verb(["said"])],
  ["see", verb(["saw", "seen"])],
  ["sell", verb(["sold"])],
  ["send", verb(["sent"])],
  ["set", verb(["set"])],
  ["show", verb(["showed", "shown"])],
  ["shut", verb(["shut"])],
  ["sit", verb(["sat"])],
  ["spend", verb(["spent"])],
  ["split", verb(["split"])],
  ["stand", verb(["stood"])],
  ["take", verb(["took", "taken"])],
  ["teach", verb(["taught"])],
  ["tell", verb(["told"])],
  ["think", verb(["thought"])],
  ["throw", verb(["threw", "thrown"])],
  ["undo", verb(["undid", "undone"])],
  ["understand", verb(["understood"])],
  ["withdraw", verb(["withdrew", "withdrawn"])],
  ["write", verb(["wrote", "written"])],
  ["override", verb(["overrode", "overridden"])],
  ["overwrite", verb(["overwrote", "overwritten"])],
]);

function isConsonant(char: string | undefined): boolean {
  return (
    char !== undefined && char >= "a" && char <= "z" && !VOWELS.includes(char)
  );
}

function endsConsonantY(word: string): boolean {
  return word.endsWith("y") && isConsonant(word[word.length - 2]);
}

/** The -s ending: "logs", "fixes", "applies". */
function addS(word: string): string {
  if (
    word.endsWith("s") ||
    word.endsWith("x") ||
    word.endsWith("z") ||
    word.endsWith("ch") ||
    word.endsWith("sh")
  ) {
    return word + "es";
  }
  if (endsConsonantY(word)) {
    return word.slice(0, -1) + "ies";
  }
  return word + "s";
}

function addEd(word: string): string {
  if (word.endsWith("e")) {
    return word + "d";
  }
  if (endsConsonantY(word)) {
    return word.slice(0, -1) + "ied";
  }
  return word + "ed";
}

function addIng(word: string): string {
  if (word.endsWith("ie")) {
    return word.slice(0, -2) + "ying";
  }
  if (
    word.endsWith("e") &&
    !word.endsWith("ee") &&
    !word.endsWith("ye") &&
    !word.endsWith("oe")
  ) {
    return word.slice(0, -1) + "ing";
  }
  return word + "ing";
}

/** Consonant, vowel, consonant at the end, the last one not w, x or y. */
function doublesLastLetter(word: string): boolean {
  const n = word.length;
  const last = word[n - 1];
  return (
    n >= 3 &&
    isConsonant(word[n - 3]) &&
    VOWELS.includes(word[n - 2] ?? "") &&
    isConsonant(last) &&
    last !== "w" &&
    last !== "x" &&
    last !== "y"
  );
}

function verbForms(word: string): readonly string[] {
  const irregular = IRREGULAR_VERBS.get(word);
  const forms = [irregular?.third ?? addS(word)];
  if (irregular === undefined) {
    forms.push(addEd(word));
  } else {
    forms.push(...irregular.past);
  }
  forms.push(addIng(word));
  if (doublesLastLetter(word)) {
    const last = word.slice(-1);
    if (irregular === undefined) {
      forms.push(word + last + "ed");
    }
    forms.push(word + last + "ing");
  }
  return forms;
}

function isInflectable(word: string): boolean {
  return word.length >= 2 && WORD.test(word);
}

/**
 * Spellings of a variant other than the variant itself, lower case, no
 * repeats, never the variant's own spelling.
 */
export function inflectedForms(variant: string): readonly string[] {
  const lowered = variant.toLowerCase().replace(WHITESPACE, " ").trim();
  const words = lowered.split(" ");
  const first = words[0] ?? "";
  const found = new Set<string>();

  if (isInflectable(first)) {
    for (const form of verbForms(first)) {
      found.add([form, ...words.slice(1)].join(" "));
    }
  }
  const last = words[words.length - 1] ?? "";
  if (words.length >= 2 && isInflectable(last)) {
    found.add([...words.slice(0, -1), addS(last)].join(" "));
  }
  found.delete(lowered);
  return [...found];
}
