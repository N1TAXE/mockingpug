import { describe, expect, it } from 'vitest';
import { createRng, hashString, mulberry32, pick, randomInt } from '../../src/core/rng.js';

describe('rng', () => {
  it('hashString is deterministic for the same input', () => {
    expect(hashString('user::1::id')).toBe(hashString('user::1::id'));
  });

  it('hashString differs for different inputs', () => {
    expect(hashString('user::1::id')).not.toBe(hashString('user::2::id'));
  });

  it('mulberry32 produces a deterministic sequence for a given seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const sequenceA = Array.from({ length: 5 }, () => a());
    const sequenceB = Array.from({ length: 5 }, () => b());
    expect(sequenceA).toEqual(sequenceB);
  });

  it('createRng is a pure function of its parts : same parts, same output, regardless of call order elsewhere', () => {
    const rngA = createRng('mySeed', 'user', 3, 'email');
    const rngB = createRng('mySeed', 'user', 3, 'email');
    expect(rngA()).toBe(rngB());
  });

  it('createRng produces different sequences for different field names (no cross-field correlation)', () => {
    const emailRng = createRng('mySeed', 'user', 3, 'email');
    const nameRng = createRng('mySeed', 'user', 3, 'name');
    expect(emailRng()).not.toBe(nameRng());
  });

  it('randomInt stays within [min, max] inclusive across many draws', () => {
    const rng = createRng('bounds-test');
    for (let i = 0; i < 200; i++) {
      const value = randomInt(rng, 5, 9);
      expect(value).toBeGreaterThanOrEqual(5);
      expect(value).toBeLessThanOrEqual(9);
    }
  });

  it('pick only returns items from the given array', () => {
    const rng = createRng('pick-test');
    const items = ['a', 'b', 'c'];
    for (let i = 0; i < 50; i++) {
      expect(items).toContain(pick(rng, items));
    }
  });

  it('pick throws on an empty array', () => {
    const rng = createRng('empty');
    expect(() => pick(rng, [])).toThrow(RangeError);
  });
});
