import { describe, expect, it } from 'vitest';
import { parseConditional, parseFieldValue } from '../../src/core/conditional.js';
import { applyOp, type SchemaSource } from '../../src/core/schemaOps.js';
import { validateSchemas } from '../../src/core/validateSchema.js';
import { generateSample } from '../../src/core/generateSample.js';

const conditional = { when: { status: 'paid' }, then: 'date.past', else: null };

describe('parseFieldValue (R13)', () => {
  it('parses a DSL string', () => {
    expect(parseFieldValue('number.1-100').kind).toBe('number');
  });

  it('parses a {when,then,else} conditional object', () => {
    const spec = parseFieldValue(conditional);
    expect(spec.kind).toBe('conditional');
  });

  it('parseConditional is exported and returns a conditional spec', () => {
    expect(parseConditional(conditional, {}, 'orders').kind).toBe('conditional');
  });

  it('throws on an array / non-object value', () => {
    expect(() => parseFieldValue([1, 2] as unknown)).toThrow();
  });
});

describe('validateSchemas with the full format (R13)', () => {
  it('accepts a valid conditional field', () => {
    const s: SchemaSource = {
      tables: { orders: { amount: 5, data: { id: 'uuid', status: 'enum[paid,pending]', paidAt: conditional } } },
    };
    expect(validateSchemas(s)).toEqual([]);
  });

  it('flags a conditional whose when-field does not exist (MP-SCHEMA-026)', () => {
    const s: SchemaSource = { tables: { orders: { amount: 5, data: { id: 'uuid', paidAt: { when: { nope: 'x' }, then: 'date', else: null } } } } };
    expect(validateSchemas(s).some((i) => i.code === 'MP-SCHEMA-026')).toBe(true);
  });

  it('flags a conditional whose when-field is declared later (MP-SCHEMA-027)', () => {
    const s: SchemaSource = { tables: { orders: { amount: 5, data: { id: 'uuid', paidAt: conditional, status: 'enum[paid,pending]' } } } };
    expect(validateSchemas(s).some((i) => i.code === 'MP-SCHEMA-027')).toBe(true);
  });

  it('flags literal.length greater than amount (MP-SCHEMA-019)', () => {
    const s: SchemaSource = { tables: { u: { amount: 1, data: { id: 'uuid' }, literal: [{ id: 1 }, { id: 2 }] } } };
    expect(validateSchemas(s).some((i) => i.code === 'MP-SCHEMA-019')).toBe(true);
  });
});

describe('schemaOps with the full format (R13)', () => {
  it('table.rename rewrites a cross-ref inside a conditional branch', () => {
    const s: SchemaSource = {
      tables: {
        users: { amount: 1, data: { id: 'uuid' } },
        orders: { amount: 1, data: { id: 'uuid', ref: { when: { id: '1' }, then: 'data.users.id', else: null } } },
      },
    };
    const renamed = applyOp(s, { type: 'table.rename', from: 'users', to: 'members' });
    const cond = renamed.tables.orders!.data.ref as { then: string };
    expect(cond.then).toBe('data.members.id');
  });

  it('carries literal and bypass through operations untouched', () => {
    const s: SchemaSource = { tables: { u: { amount: 3, data: { id: 'uuid' }, literal: [{ id: 1 }], bypass: true } } };
    const next = applyOp(s, { type: 'field.add', table: 'u', name: 'name', dsl: 'lorem' });
    expect(next.tables.u!.literal).toEqual([{ id: 1 }]);
    expect(next.tables.u!.bypass).toBe(true);
  });
});

describe('generateSample with the full format (R13)', () => {
  it('resolves conditional fields and places literal rows at the head', () => {
    const s: SchemaSource = {
      tables: {
        orders: {
          amount: 5,
          data: { id: 'number.increment', status: 'enum[paid,pending]', paidAt: conditional },
          literal: [{ id: 100, status: 'paid', paidAt: '2020-01-01' }],
        },
      },
    };
    const rows = generateSample(s, 'orders', { count: 4, seed: 's' });
    expect(rows[0]).toEqual({ id: 100, status: 'paid', paidAt: '2020-01-01' }); // literal verbatim
    // generated rows have the conditional field present (a date string or null)
    for (const r of rows.slice(1)) {
      expect('paidAt' in r).toBe(true);
    }
  });
});
