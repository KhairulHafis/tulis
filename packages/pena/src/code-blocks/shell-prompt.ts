export type ShellPrompt = "dollar" | "none";

function isBlank(char: string | undefined): boolean {
  return char === " " || char === "\t";
}

/**
 * Judges a shell block by its first line that is neither blank nor a comment:
 * "dollar" when it starts with "$ " (after spaces and tabs), else "none".
 * Undefined when no line decides. Reads one line at a time, never the whole value twice.
 */
export function shellPrompt(value: string): ShellPrompt | undefined {
  let lineStart = 0;
  while (lineStart <= value.length) {
    const newline = value.indexOf("\n", lineStart);
    let lineEnd = newline === -1 ? value.length : newline;
    if (lineEnd > lineStart && value[lineEnd - 1] === "\r") {
      lineEnd -= 1;
    }
    let i = lineStart;
    while (i < lineEnd && isBlank(value[i])) {
      i += 1;
    }
    if (i < lineEnd && value[i] !== "#") {
      return value[i] === "$" && value[i + 1] === " " && i + 1 < lineEnd
        ? "dollar"
        : "none";
    }
    if (newline === -1) {
      return undefined;
    }
    lineStart = newline + 1;
  }
  return undefined;
}
