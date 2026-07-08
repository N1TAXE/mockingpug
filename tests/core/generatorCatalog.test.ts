import { describe, expect, it } from 'vitest';
import { GENERATOR_CATALOG } from '../../src/core/generatorCatalog.js';
import { parseFieldType } from '../../src/core/parser.js';

describe('GENERATOR_CATALOG', () => {
  it('every entry with an example parses without throwing, so the catalog cannot drift from the real parser', () => {
    for (const entry of GENERATOR_CATALOG) {
      if (entry.example === undefined) continue;
      expect(() => parseFieldType(entry.example!), `"${entry.syntax}" example "${entry.example}"`).not.toThrow();
    }
  });

  it('has no duplicate syntax entries', () => {
    const syntaxes = GENERATOR_CATALOG.map((e) => e.syntax);
    expect(new Set(syntaxes).size).toBe(syntaxes.length);
  });
});
