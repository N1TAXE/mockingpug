import { describe, expect, it } from 'vitest';
import { applyOp, type SchemaSource } from '../../src/core/schemaOps.js';
import { validateSchemas } from '../../src/core/validateSchema.js';

function saas(): SchemaSource {
  return {
    tables: {
      users: { amount: 100, data: { id: 'number.increment', name: 'username.FS', email: 'email', orders: 'data.orders' } },
      orders: { amount: 300, data: { id: 'number.increment', userId: 'data.users.id', total: 'number.1-100' } },
    },
  };
}

describe('validateSchemas (R3)', () => {
  it('a valid schema yields no issues', () => {
    expect(validateSchemas(saas())).toEqual([]);
  });

  it('collects a DSL parse error with code + hint (did you mean)', () => {
    const s = applyOp(saas(), { type: 'field.setDsl', table: 'users', name: 'email', dsl: 'emial' });
    const issues = validateSchemas(s);
    const issue = issues.find((i) => i.field === 'email')!;
    expect(issue).toBeDefined();
    expect(issue.code).toBe('MP-SCHEMA-001');
    expect(issue.hint).toContain('did you mean');
  });

  it('flags a reference to an unknown table', () => {
    const s = applyOp(saas(), { type: 'table.remove', name: 'orders' });
    const issues = validateSchemas(s);
    // users.orders (reverse list) now points at a missing table
    expect(issues.some((i) => i.code === 'MP-DEP-001' && i.field === 'orders')).toBe(true);
  });

  it('flags a bad amount and empty data, collecting both at once', () => {
    const s: SchemaSource = { tables: { a: { amount: -1, data: {} } } };
    const issues = validateSchemas(s);
    expect(issues.some((i) => i.code === 'MP-VALID-002')).toBe(true);
    expect(issues.some((i) => i.code === 'MP-VALID-004')).toBe(true);
  });

  it('flags a slugify whose source field is missing', () => {
    const s: SchemaSource = { tables: { p: { amount: 1, data: { id: 'uuid', slug: 'slugify[title,-]' } } } };
    const issues = validateSchemas(s);
    expect(issues.some((i) => i.code === 'MP-VALID-008')).toBe(true);
  });

  it('flags an invalid table name', () => {
    const s: SchemaSource = { tables: { 'my-entity': { amount: 1, data: { id: 'uuid' } } } };
    expect(validateSchemas(s).some((i) => i.code === 'MP-VALID-001')).toBe(true);
  });

  it('flags a reverse list with no field linking back', () => {
    const s: SchemaSource = {
      tables: {
        users: { amount: 1, data: { id: 'uuid', orders: 'data.orders' } },
        orders: { amount: 1, data: { id: 'uuid' } }, // no userId back-ref
      },
    };
    expect(validateSchemas(s).some((i) => i.code === 'MP-DEP-003')).toBe(true);
  });

  it('flags a field-level ref to a non-existent field on the target', () => {
    const s: SchemaSource = {
      tables: {
        users: { amount: 1, data: { id: 'uuid' } },
        orders: { amount: 1, data: { u: 'data.users.nope' } },
      },
    };
    expect(validateSchemas(s).some((i) => i.code === 'MP-VALID-007')).toBe(true);
  });

  it('detects a foreign-key cycle', () => {
    const s: SchemaSource = {
      tables: {
        a: { amount: 1, data: { id: 'uuid', b: 'data.b.id' } },
        b: { amount: 1, data: { id: 'uuid', a: 'data.a.id' } },
      },
    };
    expect(validateSchemas(s).some((i) => i.code === 'MP-DEP-002')).toBe(true);
  });

  it('parses custom dictionary names as valid when passed knownCustomTypes', () => {
    const s: SchemaSource = { tables: { u: { amount: 1, data: { id: 'uuid', role: 'role' } } } };
    expect(validateSchemas(s, { knownCustomTypes: ['role'] })).toEqual([]);
    // without it, "role" is an unknown generator
    expect(validateSchemas(s).some((i) => i.field === 'role')).toBe(true);
  });
});
