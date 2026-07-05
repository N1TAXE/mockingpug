import { describe, expect, it } from 'vitest';
import { levenshtein, closestMatch, closestMatchScored } from '../../src/core/levenshtein.js';

describe('levenshtein', () => {
  it('is 0 for identical strings', () => {
    expect(levenshtein('email', 'email')).toBe(0);
  });

  it('handles empty strings', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
  });

  it('counts substitutions correctly', () => {
    expect(levenshtein('emial', 'email')).toBe(2);
  });
});

describe('closestMatch', () => {
  it('returns the nearest candidate within the default distance', () => {
    expect(closestMatch('emial', ['uuid', 'email', 'hash'])).toBe('email');
  });

  it('returns undefined when nothing is close enough', () => {
    expect(closestMatch('zzzzzzzzzz', ['uuid', 'email'])).toBeUndefined();
  });

  it('returns undefined for an empty candidate list', () => {
    expect(closestMatchScored('anything', [])).toBeUndefined();
  });
});
