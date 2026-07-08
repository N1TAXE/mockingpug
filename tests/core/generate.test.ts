import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/core/rng.js';
import { generateValue, IncrementCounters, type GenerateContext } from '../../src/core/generate.js';
import { GenerationError } from '../../src/core/errors.js';
import type { FieldSpec } from '../../src/core/types.js';

function makeCtx(overrides: Partial<GenerateContext> = {}): GenerateContext {
  return {
    resolveCustom: () => {
      throw new Error('resolveCustom not stubbed for this test');
    },
    increments: new IncrementCounters(),
    incrementKey: 'entity.field',
    ...overrides,
  };
}

describe('generateValue', () => {
  it('generates a well-formed uuid', () => {
    const value = generateValue({ kind: 'uuid' }, createRng('s'), makeCtx());
    expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('uuid is deterministic from the seed : not backed by crypto.randomUUID()', () => {
    const a = generateValue({ kind: 'uuid' }, createRng('same-seed'), makeCtx());
    const b = generateValue({ kind: 'uuid' }, createRng('same-seed'), makeCtx());
    expect(a).toBe(b);
  });

  it('uuid differs across different seeds', () => {
    const a = generateValue({ kind: 'uuid' }, createRng('seed-a'), makeCtx());
    const b = generateValue({ kind: 'uuid' }, createRng('seed-b'), makeCtx());
    expect(a).not.toBe(b);
  });

  it('number.increment counts up per key, independent of other keys', () => {
    const increments = new IncrementCounters();
    const spec: FieldSpec = { kind: 'number', mode: 'increment' };
    const rng = createRng('s');
    const first = generateValue(spec, rng, makeCtx({ increments, incrementKey: 'user.id' }));
    const second = generateValue(spec, rng, makeCtx({ increments, incrementKey: 'user.id' }));
    const otherEntity = generateValue(spec, rng, makeCtx({ increments, incrementKey: 'blogpost.id' }));
    expect(first).toBe(1);
    expect(second).toBe(2);
    expect(otherEntity).toBe(1);
  });

  it('IncrementCounters.seed fast-forwards so appended records continue numbering', () => {
    const increments = new IncrementCounters();
    increments.seed('user.id', 1000);
    expect(increments.next('user.id')).toBe(1001);
  });

  it('IncrementCounters.seed never moves the counter backwards', () => {
    const increments = new IncrementCounters();
    expect(increments.next('user.id')).toBe(1);
    increments.seed('user.id', 0);
    expect(increments.next('user.id')).toBe(2);
  });

  it('number.min-max stays within bounds', () => {
    const rng = createRng('bounds');
    for (let i = 0; i < 100; i++) {
      const value = generateValue({ kind: 'number', mode: 'random', min: 18, max: 65 }, rng, makeCtx());
      expect(value).toBeGreaterThanOrEqual(18);
      expect(value).toBeLessThanOrEqual(65);
    }
  });

  it('number.float.min-max.precision stays within bounds and rounds to precision', () => {
    const rng = createRng('float-bounds');
    for (let i = 0; i < 100; i++) {
      const value = generateValue({ kind: 'number', mode: 'random', min: 4, max: 5, precision: 1 }, rng, makeCtx()) as number;
      expect(value).toBeGreaterThanOrEqual(4);
      expect(value).toBeLessThanOrEqual(5);
      expect(value).toBeCloseTo(Math.round(value * 10) / 10, 10);
    }
  });

  it('number.float with precision 0 rounds to a whole number but stays a float-capable path', () => {
    const rng = createRng('float-zero');
    const value = generateValue({ kind: 'number', mode: 'random', min: 1, max: 10, precision: 0 }, rng, makeCtx());
    expect(Number.isInteger(value)).toBe(true);
  });

  it('username.FS produces "First Last"', () => {
    const value = generateValue({ kind: 'username', style: 'FS' }, createRng('s'), makeCtx());
    expect(value).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });

  it('username.NN produces an AdjectiveNounNNN nickname', () => {
    const value = generateValue({ kind: 'username', style: 'NN' }, createRng('s'), makeCtx());
    expect(value).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+\d+$/);
  });

  it('email respects a fixed domain', () => {
    const value = generateValue({ kind: 'email', domain: 'gmail.com' }, createRng('s'), makeCtx());
    expect(value).toMatch(/@gmail\.com$/);
  });

  it('email without a fixed domain picks one from the built-in list', () => {
    const value = generateValue({ kind: 'email' }, createRng('s'), makeCtx()) as string;
    expect(value).toContain('@');
  });

  it('hash produces a hex string for each algorithm', () => {
    const generic = generateValue({ kind: 'hash', algorithm: 'generic' }, createRng('s'), makeCtx()) as string;
    const md5 = generateValue({ kind: 'hash', algorithm: 'md5' }, createRng('s'), makeCtx()) as string;
    const sha256 = generateValue({ kind: 'hash', algorithm: 'sha256' }, createRng('s'), makeCtx()) as string;
    expect(generic).toMatch(/^[0-9a-f]+$/);
    expect(md5).toMatch(/^[0-9a-f]{32}$/);
    expect(sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('lorem without a fixed length produces a non-empty phrase', () => {
    const value = generateValue({ kind: 'lorem' }, createRng('s'), makeCtx()) as string;
    expect(value.length).toBeGreaterThan(0);
  });

  it('date produces an ISO string, respecting past/future/default range', () => {
    const isIso = (value: unknown) => expect(() => new Date(value as string).toISOString()).not.toThrow();
    isIso(generateValue({ kind: 'date' }, createRng('s'), makeCtx()));
    isIso(generateValue({ kind: 'date', range: 'past' }, createRng('s'), makeCtx()));
    isIso(generateValue({ kind: 'date', range: 'future' }, createRng('s'), makeCtx()));
  });

  it('lorem.N produces text of exactly length N', () => {
    const value = generateValue({ kind: 'lorem', length: 32 }, createRng('s'), makeCtx()) as string;
    expect(value).toHaveLength(32);
  });

  it('boolean respects an explicit chance across many draws', () => {
    const rng = createRng('chance-test');
    let trueCount = 0;
    const draws = 2000;
    for (let i = 0; i < draws; i++) {
      if (generateValue({ kind: 'boolean', chance: 0.8 }, rng, makeCtx())) trueCount++;
    }
    expect(trueCount / draws).toBeGreaterThan(0.7);
    expect(trueCount / draws).toBeLessThan(0.9);
  });

  it('enumInline only returns one of the given values', () => {
    const rng = createRng('s');
    const values = ['draft', 'published'];
    for (let i = 0; i < 20; i++) {
      expect(values).toContain(generateValue({ kind: 'enumInline', values }, rng, makeCtx()));
    }
  });

  it('array generates exactly `count` items using the item spec', () => {
    const value = generateValue(
      { kind: 'array', item: { kind: 'lorem', length: 8 }, count: 3 },
      createRng('s'),
      makeCtx(),
    ) as string[];
    expect(value).toHaveLength(3);
    for (const item of value) expect(item).toHaveLength(8);
  });

  it('custom delegates to ctx.resolveCustom', () => {
    const value = generateValue(
      { kind: 'custom', name: 'role' },
      createRng('s'),
      makeCtx({ resolveCustom: (name) => `resolved:${name}` }),
    );
    expect(value).toBe('resolved:role');
  });

  it('crossRef is explicitly out of scope for generateValue', () => {
    expect(() =>
      generateValue({ kind: 'crossRef', entity: 'user', field: 'id' }, createRng('s'), makeCtx()),
    ).toThrow(GenerationError);
  });

  it('is deterministic: same seed + same field key => same value', () => {
    const spec: FieldSpec = { kind: 'email', domain: 'gmail.com' };
    const a = generateValue(spec, createRng('seed-x', 'user', 5, 'email'), makeCtx());
    const b = generateValue(spec, createRng('seed-x', 'user', 5, 'email'), makeCtx());
    expect(a).toBe(b);
  });
});
