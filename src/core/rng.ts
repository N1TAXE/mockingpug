/**
 * Deterministic, dependency-free RNG. Every generated field is a pure
 * function of (seed, entity, index, field), so any process can reproduce
 * the exact same record without shared state.
 */

/** FNV-1a 32-bit hash: fast, good-enough distribution for seeding, not for security. */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export type Rng = () => number;

/** mulberry32: small, fast, deterministic PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Combines arbitrary seed parts (base seed, entity, index, field name...) into one RNG. */
export function createRng(...parts: Array<string | number>): Rng {
  const combined = parts.join('::');
  return mulberry32(hashString(combined));
}

export function randomInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) {
    throw new RangeError('pick() called with an empty array');
  }
  return items[randomInt(rng, 0, items.length - 1)]!;
}
