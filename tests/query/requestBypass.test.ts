import { describe, expect, it } from 'vitest';
import { RequestBypass } from '../../src/query/requestBypass.js';

describe('RequestBypass', () => {
  it('isBypassed() is false for a request that was never bypassed', () => {
    const bypass = new RequestBypass();
    expect(bypass.isBypassed('GET', '/api/faqCategory')).toBe(false);
  });

  it('set(method, pathname, true) makes isBypassed() true for exactly that method+pathname', () => {
    const bypass = new RequestBypass();
    bypass.set('GET', '/api/faqCategory', true);
    expect(bypass.isBypassed('GET', '/api/faqCategory')).toBe(true);
    expect(bypass.isBypassed('GET', '/api/faqCategory/1')).toBe(false);
  });

  it('set(method, pathname, false) un-bypasses a previously bypassed request', () => {
    const bypass = new RequestBypass();
    bypass.set('GET', '/api/faqCategory', true);
    bypass.set('GET', '/api/faqCategory', false);
    expect(bypass.isBypassed('GET', '/api/faqCategory')).toBe(false);
  });

  it('a list route and an item route bypass independently', () => {
    const bypass = new RequestBypass();
    bypass.set('GET', '/api/faqCategory/1', true);
    expect(bypass.isBypassed('GET', '/api/faqCategory/1')).toBe(true);
    expect(bypass.isBypassed('GET', '/api/faqCategory')).toBe(false);
  });

  it('is scoped per method: GET and POST on the same pathname bypass independently', () => {
    const bypass = new RequestBypass();
    bypass.set('GET', '/api/faqCategory', true);
    expect(bypass.isBypassed('POST', '/api/faqCategory')).toBe(false);
  });

  it('method matching is case-insensitive', () => {
    const bypass = new RequestBypass();
    bypass.set('get', '/api/faqCategory', true);
    expect(bypass.isBypassed('GET', '/api/faqCategory')).toBe(true);
  });

  it('list() returns every currently-bypassed "METHOD pathname" key', () => {
    const bypass = new RequestBypass();
    bypass.set('GET', '/api/faqCategory', true);
    bypass.set('GET', '/api/faqCategory/1', true);
    bypass.set('POST', '/api/faqCategory', true);
    bypass.set('GET', '/api/faqCategory/1', false);
    expect(new Set(bypass.list())).toEqual(new Set(['GET /api/faqCategory', 'POST /api/faqCategory']));
  });

  it('list() returns an empty array when nothing is bypassed', () => {
    const bypass = new RequestBypass();
    expect(bypass.list()).toEqual([]);
  });

  it('un-bypassing a request that was never bypassed is a harmless no-op', () => {
    const bypass = new RequestBypass();
    expect(() => bypass.set('DELETE', '/api/faqCategory/999', false)).not.toThrow();
    expect(bypass.isBypassed('DELETE', '/api/faqCategory/999')).toBe(false);
  });
});
