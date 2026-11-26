const MAX_KEY_LENGTH = 100;
const MAX_DISTANCE = 2;

function editDistance(a: string, b: string): number {
  let previous: number[] = [];
  for (let j = 0; j <= b.length; j++) {
    previous.push(j);
  }
  for (let i = 1; i <= a.length; i++) {
    const current: number[] = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current.push(
        Math.min(
          (previous[j] ?? 0) + 1,
          (current[j - 1] ?? 0) + 1,
          (previous[j - 1] ?? 0) + cost,
        ),
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/** The known key a mistyped key most likely meant, or undefined. */
export function closestKey(
  unknownKey: string,
  knownKeys: readonly string[],
): string | undefined {
  if (unknownKey.length > MAX_KEY_LENGTH) {
    return undefined;
  }
  const lower = unknownKey.toLowerCase();
  for (const known of knownKeys) {
    if (known.toLowerCase() === lower) {
      return known;
    }
  }
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const known of knownKeys) {
    const distance = editDistance(lower, known.toLowerCase());
    if (distance < bestDistance) {
      best = known;
      bestDistance = distance;
    }
  }
  if (bestDistance <= MAX_DISTANCE && bestDistance < unknownKey.length / 2) {
    return best;
  }
  return undefined;
}
