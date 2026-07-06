import { describe, expect, it } from 'vitest';
import { slugify } from '../../src/core/slugify.js';

describe('slugify', () => {
  it('lowercases and separates words with the given separator', () => {
    expect(slugify('Hello World', '-')).toBe('hello-world');
    expect(slugify('Hello, World!', '-')).toBe('hello-world');
  });

  it('transliterates Cyrillic to Latin', () => {
    expect(slugify('ВКонтакте', '-')).toBe('vkontakte');
    expect(slugify('Щука в желе', '-')).toBe('shchuka-v-zhele');
  });

  it('strips Latin diacritics', () => {
    expect(slugify('Café Münchén', '-')).toBe('cafe-munchen');
  });

  it('supports an underscore separator', () => {
    expect(slugify('Hello World', '_')).toBe('hello_world');
  });

  it('supports a regex-special separator', () => {
    expect(slugify('Hello World', '.')).toBe('hello.world');
  });

  it('collapses runs of non-alphanumeric characters into one separator', () => {
    expect(slugify('Hello   ---   World', '-')).toBe('hello-world');
  });

  it('trims leading/trailing separators', () => {
    expect(slugify('  Hello World!!  ', '-')).toBe('hello-world');
  });

  it('concatenates words with an empty separator instead of trimming/collapsing', () => {
    expect(slugify('Hello World', '')).toBe('helloworld');
  });

  it('is deterministic for the same input', () => {
    expect(slugify('Facebook', '-')).toBe(slugify('Facebook', '-'));
  });
});
