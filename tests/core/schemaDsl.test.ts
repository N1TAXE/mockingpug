import { describe, expect, it } from 'vitest';
import { GENERATOR_CATALOG } from '../../src/core/generatorCatalog.js';
import { parseFieldType } from '../../src/core/parser.js';
import { ENTITY_NAME_RE, isValidEntityName, relationTarget, stringifyFieldType } from '../../src/core/schemaDsl.js';
import type { FieldSpec } from '../../src/core/types.js';

describe('stringifyFieldType (R2)', () => {
  it('round-trips every string DSL example in GENERATOR_CATALOG', () => {
    for (const { example } of GENERATOR_CATALOG) {
      if (!example) continue;
      const spec = parseFieldType(example);
      expect(parseFieldType(stringifyFieldType(spec)), `example "${example}"`).toEqual(spec);
    }
  });

  it('round-trips number.float with precision', () => {
    const spec = parseFieldType('number.float.4-5.1');
    expect(stringifyFieldType(spec)).toBe('number.float.4-5.1');
  });

  it('throws on object-only forms (literal, conditional) that have no string DSL', () => {
    const literal: FieldSpec = { kind: 'literal', value: 42 };
    const conditional: FieldSpec = {
      kind: 'conditional',
      when: { status: 'paid' },
      then: { kind: 'date' },
      else: { kind: 'literal', value: null },
    };
    expect(() => stringifyFieldType(literal)).toThrow(/no string DSL/);
    expect(() => stringifyFieldType(conditional)).toThrow(/no string DSL/);
  });
});

describe('relationTarget', () => {
  it('extracts the target entity of a cross-ref DSL, ignoring the field part', () => {
    expect(relationTarget('data.users')).toBe('users');
    expect(relationTarget('data.users.id')).toBe('users');
    expect(relationTarget('data.users.[id,name]')).toBe('users');
  });

  it('is undefined for non-relation DSL', () => {
    expect(relationTarget('number.1-100')).toBeUndefined();
    expect(relationTarget('email')).toBeUndefined();
  });
});

describe('ENTITY_NAME_RE / isValidEntityName (R7)', () => {
  it('accepts identifiers that the data.<entity> parser can resolve', () => {
    for (const ok of ['users', 'blogPost', '_x', 'a1', 'order_items']) {
      expect(isValidEntityName(ok), ok).toBe(true);
    }
  });

  it('rejects names the cross-ref regex would not resolve', () => {
    for (const bad of ['my-entity', '1users', 'a b', '', 'a.b']) {
      expect(isValidEntityName(bad), bad).toBe(false);
    }
  });

  it('ENTITY_NAME_RE is exported and matches isValidEntityName', () => {
    expect(ENTITY_NAME_RE.test('users')).toBe(true);
    expect(ENTITY_NAME_RE.test('my-entity')).toBe(false);
  });
});
