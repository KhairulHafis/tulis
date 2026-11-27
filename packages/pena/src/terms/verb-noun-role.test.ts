import { describe, expect, it } from "vitest";
import type { PartOfSpeech, TaggedToken } from "../language/tag-tokens.js";
import { termRole } from "./verb-noun-role.js";

/** Builds tags from "text/pos" pieces; a piece with no "/" is a word tagged "other". */
function tagsOf(...pieces: string[]): TaggedToken[] {
  let offset = 0;
  return pieces.map((piece) => {
    const [text = "", pos = "other"] = piece.split("/");
    const start = offset;
    offset += text.length + 1;
    return {
      text,
      kind: "word",
      placeholder: undefined,
      maskedStart: start,
      maskedEnd: start + text.length,
      source: { start, end: start + text.length },
      pos: pos as PartOfSpeech,
      verbForm: undefined,
    };
  });
}

describe("rule 0a: hyphen form before a modifier target", () => {
  it.each(["noun", "properNoun", "adjective", "placeholder"])(
    "skips when a %s follows",
    (pos) => {
      expect(termRole(tagsOf("log-in/verb", "x/" + pos), 0, 0, "log in")).toBe(
        undefined,
      );
    },
  );

  it("skips a hyphen form split over tokens", () => {
    const tags = tagsOf("the", "log/noun", "-", "in/adverb", "screen/noun");
    expect(termRole(tags, 1, 3, "log in")).toBe(undefined);
  });

  it("does not skip when a verb follows", () => {
    expect(termRole(tagsOf("log-in/verb", "now/adverb"), 0, 0, "log in")).toBe(
      "verb",
    );
  });
});

describe("rule 0b: open form starting with an adverb or preposition", () => {
  // "you" would make rule 4 say verb, so only rule 0b can give undefined.
  it.each(["adverb", "preposition"])("skips a first word tagged %s", (pos) => {
    expect(
      termRole(tagsOf("you", "back/" + pos, "up/preposition"), 1, 2, "back up"),
    ).toBe(undefined);
  });

  it("does not skip a first word tagged verb", () => {
    expect(
      termRole(tagsOf("you", "back/verb", "up/preposition"), 1, 2, "back up"),
    ).toBe("verb");
  });
});

describe("rule 0c: open form directly after a verb", () => {
  it("skips after a verb that is not a verb-before word", () => {
    expect(
      termRole(tagsOf("scroll/verb", "back", "up", "to"), 1, 2, "back up"),
    ).toBe(undefined);
  });

  it("does not skip after a verb-before word tagged verb", () => {
    expect(termRole(tagsOf("can/verb", "back", "up"), 1, 2, "back up")).toBe(
      "verb",
    );
  });
});

describe("rule 0d: open form after a noun phrase", () => {
  it("skips when the token before is a noun and two before is a determiner", () => {
    expect(
      termRole(
        tagsOf("a/determiner", "job/noun", "log/verb", "in/verb", "full"),
        2,
        3,
        "log in",
      ),
    ).toBe(undefined);
  });

  it("control: two before is not a determiner, so rule 6 gives verb", () => {
    expect(
      termRole(
        tagsOf("deployment/noun", "tools/noun", "set/verb", "up/verb"),
        2,
        3,
        "set up",
      ),
    ).toBe("verb");
  });

  it("control: a closed form is not skipped", () => {
    expect(
      termRole(tagsOf("a/determiner", "job/noun", "setup/noun"), 2, 2, "setup"),
    ).toBe("noun");
  });
});

describe("rule 1: inflection", () => {
  it("calls a changed first word of several a verb", () => {
    expect(termRole(tagsOf("logged", "in"), 0, 1, "log in")).toBe("verb");
    expect(termRole(tagsOf("logged-in"), 0, 0, "log in")).toBe("verb");
    expect(termRole(tagsOf("sets", "up"), 0, 1, "set up")).toBe("verb");
  });

  it("calls a plural single word a noun", () => {
    expect(termRole(tagsOf("logins"), 0, 0, "login")).toBe("noun");
    expect(termRole(tagsOf("Setups"), 0, 0, "setup")).toBe("noun");
    expect(termRole(tagsOf("Matches"), 0, 0, "match")).toBe("noun");
  });

  it("decides nothing for another one-word difference", () => {
    expect(termRole(tagsOf("backedup"), 0, 0, "backup")).toBe(undefined);
  });
});

describe("rule 2: noun phrase before", () => {
  it("calls a word after a determiner a noun", () => {
    expect(termRole(tagsOf("the", "setup/verb"), 1, 1, "setup")).toBe("noun");
  });

  it("skips up to 3 adjectives or adverbs", () => {
    const three = tagsOf(
      "a",
      "very/adverb",
      "big/adjective",
      "new/adjective",
      "setup",
    );
    expect(termRole(three, 4, 4, "setup")).toBe("noun");
    const four = tagsOf(
      "a",
      "so/adverb",
      "very/adverb",
      "big/adjective",
      "new/adjective",
      "setup",
    );
    expect(termRole(four, 5, 5, "setup")).toBe(undefined);
  });

  it("accepts a possessive", () => {
    expect(termRole(tagsOf("provider's", "setup"), 1, 1, "setup")).toBe("noun");
    expect(
      termRole(
        tagsOf("provider" + String.fromCodePoint(0x2019) + "s", "setup"),
        1,
        1,
        "setup",
      ),
    ).toBe("noun");
  });

  it("does not accept a contraction with either apostrophe", () => {
    const curly = String.fromCodePoint(0x2019);
    for (const base of ["that", "it", "there", "everything", "nothing"]) {
      for (const word of [base + "'s", base + curly + "s"]) {
        expect(termRole(tagsOf(word, "setup/other"), 1, 1, "setup")).toBe(
          undefined,
        );
      }
    }
  });

  it("does not accept that, which or what", () => {
    expect(termRole(tagsOf("that", "setup"), 1, 1, "setup")).toBe(undefined);
  });
});

describe("rule 3: verb signal after", () => {
  it.each(["the", "your", "it", "them", "us", "me", "into"])(
    "calls a word before %s a verb",
    (word) => {
      expect(termRole(tagsOf("setup/noun", word), 0, 0, "setup")).toBe("verb");
    },
  );

  it("does not treat you as an object pronoun", () => {
    expect(termRole(tagsOf("setup/adjective", "you"), 0, 0, "setup")).toBe(
      undefined,
    );
  });

  it("calls a word before to and a non-verb a verb", () => {
    expect(
      termRole(tagsOf("x/noun", "login/noun", "to", "GitLab"), 1, 1, "login"),
    ).toBe("verb");
    expect(termRole(tagsOf("x/adjective", "login", "to"), 1, 1, "login")).toBe(
      "verb",
    );
  });

  it("decides nothing for to before a verb (purpose clause)", () => {
    expect(
      termRole(
        tagsOf("x/adjective", "login/adjective", "to", "happen/verb"),
        1,
        1,
        "login",
      ),
    ).toBe(undefined);
  });

  it("lets later rules decide after a purpose clause", () => {
    expect(
      termRole(
        tagsOf("cluster/noun", "setup", "to", "fix/verb"),
        1,
        1,
        "setup",
      ),
    ).toBe("noun");
  });

  it("calls a sentence-initial match before to and a verb a verb", () => {
    expect(
      termRole(tagsOf("login/noun", "to", "see/verb"), 0, 0, "login"),
    ).toBe("verb");
  });

  it("wins over a tagger noun", () => {
    expect(termRole(tagsOf("login/noun", "to"), 0, 0, "login")).toBe("verb");
  });
});

describe("rule 4: verb signal before", () => {
  it.each(["to", "should", "you", "is", "don't", "cannot", "please"])(
    "calls a word after %s a verb",
    (word) => {
      expect(termRole(tagsOf(word, "setup/noun"), 1, 1, "setup")).toBe("verb");
    },
  );

  it("beats the compound-noun rule", () => {
    expect(termRole(tagsOf("you/pronoun", "setup"), 1, 1, "setup")).toBe(
      "verb",
    );
  });

  it("looks past one adverb", () => {
    expect(
      termRole(tagsOf("are/verb", "all/adverb", "setup"), 2, 2, "setup"),
    ).toBe("verb");
  });

  it("looks past two adverbs", () => {
    expect(
      termRole(
        tagsOf("is/verb", "also/adverb", "now/adverb", "setup"),
        3,
        3,
        "setup",
      ),
    ).toBe("verb");
  });

  it("decides nothing past three adverbs", () => {
    expect(
      termRole(
        tagsOf("is/verb", "also/adverb", "now/adverb", "so/adverb", "setup"),
        4,
        4,
        "setup",
      ),
    ).toBe(undefined);
  });

  it("decides nothing past an adjective", () => {
    expect(
      termRole(tagsOf("is/verb", "big/adjective", "setup"), 2, 2, "setup"),
    ).toBe(undefined);
  });
});

describe("rule 5: compound noun", () => {
  it.each(["noun", "properNoun", "placeholder", "number"])(
    "calls a closed form after a %s a noun",
    (pos) => {
      expect(termRole(tagsOf("etcd/" + pos, "setup/verb"), 1, 1, "setup")).toBe(
        "noun",
      );
    },
  );

  it("applies to the hyphen form", () => {
    expect(termRole(tagsOf("etcd/noun", "set-up/other"), 1, 1, "set up")).toBe(
      "noun",
    );
  });

  it("does not apply to the open form", () => {
    expect(
      termRole(tagsOf("servers/noun", "set/other", "up"), 1, 2, "set up"),
    ).toBe(undefined);
  });

  it("does not apply after an adjective", () => {
    expect(
      termRole(tagsOf("big/adjective", "setup/other"), 1, 1, "setup"),
    ).toBe(undefined);
  });
});

describe("rule 6: tagger", () => {
  it("open form: verb gives verb", () => {
    expect(termRole(tagsOf("set/verb", "up"), 0, 1, "set up")).toBe("verb");
  });

  it("open form: anything else gives nothing", () => {
    expect(termRole(tagsOf("set/noun", "up"), 0, 1, "set up")).toBe(undefined);
    expect(termRole(tagsOf("set/other", "up"), 0, 1, "set up")).toBe(undefined);
  });

  it("closed form: noun gives noun", () => {
    expect(termRole(tagsOf("setup/noun"), 0, 0, "setup")).toBe("noun");
  });

  it("closed form: anything else gives nothing", () => {
    expect(termRole(tagsOf("setup/verb"), 0, 0, "setup")).toBe(undefined);
    expect(termRole(tagsOf("setup/adjective"), 0, 0, "setup")).toBe(undefined);
    expect(termRole(tagsOf("setup/other"), 0, 0, "setup")).toBe(undefined);
  });

  it("hyphen form: verb gives verb, noun gives noun, else nothing", () => {
    expect(termRole(tagsOf("set-up/verb"), 0, 0, "set up")).toBe("verb");
    expect(termRole(tagsOf("set-up/noun"), 0, 0, "set up")).toBe("noun");
    expect(termRole(tagsOf("set-up/other"), 0, 0, "set up")).toBe(undefined);
  });
});

describe("order and edges", () => {
  it("lets rule 0 win over rule 3", () => {
    expect(
      termRole(tagsOf("log-in/verb", "the", "x/noun"), 0, 0, "log in"),
    ).toBe("verb");
    expect(
      termRole(tagsOf("log-in/verb", "x/noun", "the"), 0, 0, "log in"),
    ).toBe(undefined);
  });

  it("lets rule 1 win over rule 2", () => {
    expect(termRole(tagsOf("the", "logged", "in"), 1, 2, "log in")).toBe(
      "verb",
    );
  });

  it("returns nothing for an out-of-range index", () => {
    expect(termRole(tagsOf("setup"), 3, 3, "setup")).toBe(undefined);
  });
});
