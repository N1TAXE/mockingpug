import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/core/rng.js';
import { CustomDictionaryPicker } from '../../src/core/customDictionary.js';
import { GenerationError } from '../../src/core/errors.js';

describe('CustomDictionaryPicker', () => {
  it('throws when constructed with an empty dictionary', () => {
    expect(() => new CustomDictionaryPicker('role', [])).toThrow(GenerationError);
  });

  it('never exceeds an entry\'s "max" cap across many picks', () => {
    const picker = new CustomDictionaryPicker('role', [
      { value: 'ADMIN', max: 5 },
      { value: 'USER', chance: 0.9 },
      { value: 'MODER', chance: 0.2 },
    ]);
    const rng = createRng('role-seed');
    const counts: Record<string, number> = { ADMIN: 0, USER: 0, MODER: 0 };
    for (let i = 0; i < 1000; i++) {
      const value = picker.pick(rng) as string;
      counts[value] = (counts[value] ?? 0) + 1;
    }
    expect(counts.ADMIN).toBeLessThanOrEqual(5);
  });

  it('high-chance entries dominate the distribution over many draws', () => {
    const picker = new CustomDictionaryPicker('role', [
      { value: 'ADMIN', max: 5 },
      { value: 'USER', chance: 0.9 },
      { value: 'MODER', chance: 0.2 },
    ]);
    const rng = createRng('distribution-seed');
    const counts: Record<string, number> = { ADMIN: 0, USER: 0, MODER: 0 };
    for (let i = 0; i < 1000; i++) {
      const value = picker.pick(rng) as string;
      counts[value] = (counts[value] ?? 0) + 1;
    }
    expect(counts.USER ?? 0).toBeGreaterThan(counts.MODER ?? 0);
    expect(counts.USER ?? 0).toBeGreaterThan(counts.ADMIN ?? 0);
  });

  it('falls back to a no-chance entry when no probabilistic entry hits', () => {
    const picker = new CustomDictionaryPicker('flag', [
      { value: 'DEFAULT' },
      { value: 'RARE', chance: 0.01 },
    ]);
    const rng = createRng('fallback-seed');
    const values = Array.from({ length: 200 }, () => picker.pick(rng));
    expect(values).toContain('DEFAULT');
  });

  it('throws GenerationError once every entry has hit its max', () => {
    const picker = new CustomDictionaryPicker('scarce', [{ value: 'ONLY', max: 2 }]);
    const rng = createRng('scarce-seed');
    picker.pick(rng);
    picker.pick(rng);
    expect(() => picker.pick(rng)).toThrow(GenerationError);
  });
});
