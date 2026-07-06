import { describe, expect, it } from 'vitest';
import { computeEntityMeta, computeFieldFingerprint } from '../../src/store/fingerprint.js';
import type { FieldSpec } from '../../src/core/index.js';

describe('computeFieldFingerprint', () => {
  it('is deterministic for the same spec', () => {
    const spec: FieldSpec = { kind: 'email', domain: 'gmail.com' };
    expect(computeFieldFingerprint(spec)).toBe(computeFieldFingerprint({ ...spec }));
  });

  it('is independent of key order', () => {
    const a = { kind: 'number', mode: 'random', min: 1, max: 2 } as FieldSpec;
    const b = { max: 2, min: 1, mode: 'random', kind: 'number' } as FieldSpec;
    expect(computeFieldFingerprint(a)).toBe(computeFieldFingerprint(b));
  });

  it('differs when the type changes', () => {
    const email: FieldSpec = { kind: 'email' };
    const hash: FieldSpec = { kind: 'hash', algorithm: 'generic' };
    expect(computeFieldFingerprint(email)).not.toBe(computeFieldFingerprint(hash));
  });

  it('differs when params change (email -> email[domain])', () => {
    const bare: FieldSpec = { kind: 'email' };
    const withDomain: FieldSpec = { kind: 'email', domain: 'gmail.com' };
    expect(computeFieldFingerprint(bare)).not.toBe(computeFieldFingerprint(withDomain));
  });

  it('differs across different domains', () => {
    const gmail: FieldSpec = { kind: 'email', domain: 'gmail.com' };
    const yahoo: FieldSpec = { kind: 'email', domain: 'yahoo.com' };
    expect(computeFieldFingerprint(gmail)).not.toBe(computeFieldFingerprint(yahoo));
  });

  it('handles array-shaped specs (nested item + inline enum values) deterministically', () => {
    const a: FieldSpec = { kind: 'array', item: { kind: 'enumInline', values: ['a', 'b'] }, count: 3 };
    const b: FieldSpec = { kind: 'array', item: { kind: 'enumInline', values: ['a', 'b'] }, count: 3 };
    const differentOrder: FieldSpec = {
      kind: 'array',
      item: { kind: 'enumInline', values: ['b', 'a'] },
      count: 3,
    };
    expect(computeFieldFingerprint(a)).toBe(computeFieldFingerprint(b));
    expect(computeFieldFingerprint(a)).not.toBe(computeFieldFingerprint(differentOrder));
  });
});

describe('computeEntityMeta', () => {
  it('hashes every field and preserves amount', () => {
    const meta = computeEntityMeta(1000, {
      id: { kind: 'number', mode: 'increment' },
      email: { kind: 'email', domain: 'gmail.com' },
    });
    expect(meta.amount).toBe(1000);
    expect(Object.keys(meta.fieldsHash)).toEqual(['id', 'email']);
  });

  it('produces the same fixturesHash for no fixtures and an explicit empty array', () => {
    const withoutFixtures = computeEntityMeta(5, { id: { kind: 'uuid' } });
    const withEmptyFixtures = computeEntityMeta(5, { id: { kind: 'uuid' } }, []);
    expect(withoutFixtures.fixturesHash).toBe(withEmptyFixtures.fixturesHash);
  });

  it('differs when fixtures are added', () => {
    const withoutFixtures = computeEntityMeta(5, { id: { kind: 'uuid' } });
    const withFixtures = computeEntityMeta(5, { id: { kind: 'uuid' } }, [{ slug: 'vk' }]);
    expect(withoutFixtures.fixturesHash).not.toBe(withFixtures.fixturesHash);
  });

  it('differs when a fixture value is edited', () => {
    const a = computeEntityMeta(5, { id: { kind: 'uuid' } }, [{ slug: 'vk' }]);
    const b = computeEntityMeta(5, { id: { kind: 'uuid' } }, [{ slug: 'vkontakte' }]);
    expect(a.fixturesHash).not.toBe(b.fixturesHash);
  });

  it('is independent of key order within a fixture', () => {
    const a = computeEntityMeta(5, { id: { kind: 'uuid' } }, [{ name: 'VKontakte', slug: 'vk' }]);
    const b = computeEntityMeta(5, { id: { kind: 'uuid' } }, [{ slug: 'vk', name: 'VKontakte' }]);
    expect(a.fixturesHash).toBe(b.fixturesHash);
  });
});
