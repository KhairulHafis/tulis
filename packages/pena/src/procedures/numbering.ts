export type ProcedureNumbering = "sequential" | "all-ones";

/** Most digits CommonMark allows in a list number. */
const MAX_NUMBER_DIGITS = 9;

function isDigit(char: string): boolean {
  return char >= "0" && char <= "9" && char.length === 1;
}

/**
 * Reads "12." or "12)" at `offset`: 1 to 9 ASCII digits, then "." or ")".
 * Never reads more than 10 characters. Undefined for anything else.
 */
export function readStepNumber(
  source: string,
  offset: number,
): number | undefined {
  if (!Number.isInteger(offset) || offset < 0) {
    return undefined;
  }
  let value = 0;
  let digits = 0;
  while (digits <= MAX_NUMBER_DIGITS && offset + digits < source.length) {
    const char = source.charAt(offset + digits);
    if (!isDigit(char)) {
      break;
    }
    value = value * 10 + (char.charCodeAt(0) - 48);
    digits += 1;
  }
  if (digits === 0 || digits > MAX_NUMBER_DIGITS) {
    return undefined;
  }
  const marker = source.charAt(offset + digits);
  return marker === "." || marker === ")" ? value : undefined;
}

/** All ones, or each number the previous plus one. Undefined otherwise. */
export function procedureNumbering(
  numbers: readonly (number | undefined)[],
): ProcedureNumbering | undefined {
  if (numbers.length < 2) {
    return undefined;
  }
  let allOnes = true;
  let sequential = true;
  let previous: number | undefined;
  for (const [index, number] of numbers.entries()) {
    if (number === undefined) {
      return undefined;
    }
    if (number !== 1) {
      allOnes = false;
    }
    if (index > 0 && previous !== undefined && number !== previous + 1) {
      sequential = false;
    }
    previous = number;
  }
  if (allOnes) {
    return "all-ones";
  }
  return sequential ? "sequential" : undefined;
}
