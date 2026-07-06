import { describe, expect, it } from 'vitest';
import { OneShotOverrides, hasArmedOverride } from '../../src/query/oneShotOverride.js';

describe('OneShotOverrides', () => {
  it('peek() returns undefined for an entity with nothing armed', () => {
    const overrides = new OneShotOverrides();
    expect(overrides.peek('user')).toBeUndefined();
  });

  it('set() then peek() reflects the armed override without consuming it', () => {
    const overrides = new OneShotOverrides();
    overrides.set('user', { failNext: true });
    expect(overrides.peek('user')).toEqual({ failNext: true });
    expect(overrides.peek('user')).toEqual({ failNext: true });
  });

  it('set() merges with whatever is already armed, not replacing it', () => {
    const overrides = new OneShotOverrides();
    overrides.set('user', { failNext: true });
    overrides.set('user', { delayNext: 200 });
    expect(overrides.peek('user')).toEqual({ failNext: true, delayNext: 200 });
  });

  it('consume() returns the armed override and clears it', () => {
    const overrides = new OneShotOverrides();
    overrides.set('user', { delayNext: 50 });
    expect(overrides.consume('user')).toEqual({ delayNext: 50 });
    expect(overrides.peek('user')).toBeUndefined();
  });

  it('consume() returns undefined when nothing is armed', () => {
    const overrides = new OneShotOverrides();
    expect(overrides.consume('user')).toBeUndefined();
  });

  it('is scoped per-entity: arming "user" does not affect "blogpost"', () => {
    const overrides = new OneShotOverrides();
    overrides.set('user', { failNext: true });
    expect(overrides.peek('blogpost')).toBeUndefined();
  });
});

describe('hasArmedOverride', () => {
  it('is false for undefined', () => {
    expect(hasArmedOverride(undefined)).toBe(false);
  });

  it('is false for an empty object', () => {
    expect(hasArmedOverride({})).toBe(false);
  });

  it('is false when failNext is explicitly false and delayNext is unset', () => {
    expect(hasArmedOverride({ failNext: false })).toBe(false);
  });

  it('is true when failNext is true', () => {
    expect(hasArmedOverride({ failNext: true })).toBe(true);
  });

  it('is true when delayNext is set, even to 0', () => {
    expect(hasArmedOverride({ delayNext: 0 })).toBe(true);
  });
});
