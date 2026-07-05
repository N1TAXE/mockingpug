/** Classic edit-distance, used to power "did you mean...?" hints. */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let previousRow = Array.from({ length: n + 1 }, (_, i) => i);
  let currentRow = new Array<number>(n + 1);

  for (let i = 1; i <= m; i++) {
    currentRow[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currentRow[j] = Math.min(
        previousRow[j]! + 1,
        currentRow[j - 1]! + 1,
        previousRow[j - 1]! + cost,
      );
    }
    [previousRow, currentRow] = [currentRow, previousRow];
  }

  return previousRow[n]!;
}

/** Closest candidate to `input`, together with its edit distance; undefined if `candidates` is empty. */
export function closestMatchScored(
  input: string,
  candidates: readonly string[],
): { candidate: string; distance: number } | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = levenshtein(input, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best === undefined ? undefined : { candidate: best, distance: bestDistance };
}

/** Returns the closest candidate to `input` if it's within `maxDistance`, else undefined. */
export function closestMatch(
  input: string,
  candidates: readonly string[],
  maxDistance = 3,
): string | undefined {
  const scored = closestMatchScored(input, candidates);
  return scored && scored.distance <= maxDistance ? scored.candidate : undefined;
}
