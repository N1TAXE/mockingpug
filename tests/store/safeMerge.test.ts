import { afterEach, describe, expect, it } from 'vitest';
import { safeMerge } from '../../src/store/safeMerge.js';

describe('safeMerge', () => {
  afterEach(() => {
    // Defensive cleanup in case a bug in safeMerge ever lets this slip through.
    delete (Object.prototype as Record<string, unknown>).polluted;
  });

  it('merges plain, safe patches as expected', () => {
    const target = { name: 'Alice', role: 'user' };
    const result = safeMerge(target, { role: 'admin', age: 30 });
    expect(result).toEqual({ name: 'Alice', role: 'admin', age: 30 });
  });

  it('deep-merges nested plain objects', () => {
    const target = { profile: { city: 'NYC', country: 'US' } };
    const result = safeMerge(target, { profile: { city: 'LA' } });
    expect(result).toEqual({ profile: { city: 'LA', country: 'US' } });
  });

  it('does not mutate the original target', () => {
    const target = { name: 'Alice' };
    const result = safeMerge(target, { name: 'Bob' });
    expect(target.name).toBe('Alice');
    expect(result.name).toBe('Bob');
  });

  it('drops a top-level "__proto__" key from a JSON.parse\'d attack payload', () => {
    const attack = JSON.parse('{"__proto__":{"polluted":true},"name":"Bob"}');
    const result = safeMerge({ name: 'Alice' }, attack);
    expect((result as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(result.name).toBe('Bob');
  });

  it('drops "constructor" and "prototype" keys, including nested', () => {
    const attack = JSON.parse('{"nested":{"constructor":{"prototype":{"polluted":true}}}}');
    const result = safeMerge({}, attack) as Record<string, unknown>;
    expect((result.nested as Record<string, unknown>).constructor).not.toEqual({
      prototype: { polluted: true },
    });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('never lets a nested __proto__ key leak into the real prototype chain', () => {
    const attack = JSON.parse('{"a":{"__proto__":{"polluted":true}}}');
    safeMerge({}, attack);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('replaces arrays wholesale rather than attempting to merge them', () => {
    const target = { tags: ['a', 'b'] };
    const result = safeMerge(target, { tags: ['c'] });
    expect(result.tags).toEqual(['c']);
  });
});
