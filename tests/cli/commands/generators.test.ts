import { describe, expect, it } from 'vitest';
import { generators } from '../../../src/cli/commands/generators.js';
import { GENERATOR_CATALOG } from '../../../src/core/index.js';

describe('generators', () => {
  it('is ok and prints every catalog entry, grouped under its category', () => {
    const result = generators();
    expect(result.ok).toBe(true);

    for (const entry of GENERATOR_CATALOG) {
      expect(result.messages.some((m) => m.includes(entry.syntax))).toBe(true);
    }
    expect(result.messages).toContain('Scalars:');
    expect(result.messages).toContain('Relations:');
  });

  it('includes a runnable example inline for entries that have one', () => {
    const result = generators();
    const numberFloatLine = result.messages.find((m) => m.includes('number.float.<min>-<max>.<precision>'));
    expect(numberFloatLine).toContain('e.g. "number.float.4-5.1"');
  });

  it('omits the example parenthetical for entries without a runnable example', () => {
    const result = generators();
    const customLine = result.messages.find((m) => m.includes('custom dictionary name'));
    expect(customLine).not.toContain('e.g.');
  });
});
