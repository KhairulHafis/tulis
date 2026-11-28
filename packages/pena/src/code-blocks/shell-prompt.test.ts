import { describe, expect, it } from "vitest";
import { shellPrompt } from "./shell-prompt.js";

describe("shellPrompt", () => {
  it("is dollar for a first line starting with $ and a space", () => {
    expect(shellPrompt("$ ls")).toBe("dollar");
    expect(shellPrompt("$ ")).toBe("dollar");
  });

  it("is none for other first lines", () => {
    expect(shellPrompt("ls")).toBe("none");
    expect(shellPrompt("$HOME/bin")).toBe("none");
    expect(shellPrompt("$")).toBe("none");
    expect(shellPrompt("$\tls")).toBe("none");
    expect(shellPrompt("PS> Get-Item")).toBe("none");
  });

  it("allows spaces and tabs before the dollar", () => {
    expect(shellPrompt("  $ ls")).toBe("dollar");
    expect(shellPrompt("\t$ ls")).toBe("dollar");
    expect(shellPrompt(" \t $ ls")).toBe("dollar");
  });

  it("skips blank lines and comment lines", () => {
    expect(shellPrompt("\n  \n\t\n# note\n  # more\n$ ls")).toBe("dollar");
    expect(shellPrompt("# note\nls\n$ x")).toBe("none");
  });

  it("stops at the first deciding line", () => {
    expect(shellPrompt("ls\n$ ls")).toBe("none");
    expect(shellPrompt("$ ls\nls")).toBe("dollar");
  });

  it("drops one trailing CR per line", () => {
    expect(shellPrompt("# c\r\n$ ls\r\n")).toBe("dollar");
    expect(shellPrompt("\r\n\r\nls\r\n")).toBe("none");
    expect(shellPrompt("$\r\nls")).toBe("none");
    expect(shellPrompt("#\r\n\r\n")).toBeUndefined();
  });

  it("is undefined when no line decides", () => {
    expect(shellPrompt("")).toBeUndefined();
    expect(shellPrompt("\n\n")).toBeUndefined();
    expect(shellPrompt("# only\n  # comments\n")).toBeUndefined();
    expect(shellPrompt("  \t\n")).toBeUndefined();
  });
});
