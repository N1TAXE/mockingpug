import { describe, expect, it } from 'vitest';
import { parseEntitySchema } from '../../src/core/schemaParser.js';
import { SchemaError } from '../../src/core/errors.js';

describe('parseEntitySchema : the real mock/ example (user)', () => {
  it('parses a valid raw schema object into an EntitySchema', () => {
    const schema = parseEntitySchema(
      'user',
      'mock/api/user/schema.json',
      {
        amount: 1000,
        data: { id: 'number.increment', name: 'username.FS', email: 'email[gmail.com]', role: 'role', posts: 'data.blogpost' },
      },
      ['role'],
    );
    expect(schema.name).toBe('user');
    expect(schema.amount).toBe(1000);
    expect(schema.data.role).toEqual({ kind: 'custom', name: 'role' });
    expect(schema.data.posts).toEqual({ kind: 'crossRef', entity: 'blogpost' });
  });

  it('defaults knownCustomTypes to an empty array', () => {
    const schema = parseEntitySchema('user', 'x', { amount: 1, data: { id: 'uuid' } });
    expect(schema.data.id).toEqual({ kind: 'uuid' });
  });

  it('parses an explicit "bypass: true" flag', () => {
    const schema = parseEntitySchema('user', 'x', { amount: 1, data: { id: 'uuid' }, bypass: true });
    expect(schema.bypass).toBe(true);
  });

  it('omits "bypass" from the result when not specified in the raw schema', () => {
    const schema = parseEntitySchema('user', 'x', { amount: 1, data: { id: 'uuid' } });
    expect(schema.bypass).toBeUndefined();
  });
});

describe('parseEntitySchema : validation', () => {
  it('throws SchemaError when the root is not an object', () => {
    expect(() => parseEntitySchema('user', 'x', 42)).toThrow(SchemaError);
    expect(() => parseEntitySchema('user', 'x', 42)).toThrow(expect.objectContaining({ code: 'MP-SCHEMA-006' }));
  });

  it('throws SchemaError when "amount" is missing or invalid', () => {
    try {
      parseEntitySchema('user', 'x', { data: {} });
      expect.unreachable();
    } catch (error) {
      expect((error as SchemaError).code).toBe('MP-SCHEMA-007');
    }
  });

  it('throws SchemaError when "data" is missing or invalid', () => {
    try {
      parseEntitySchema('user', 'x', { amount: 1, data: 'nope' });
      expect.unreachable();
    } catch (error) {
      expect((error as SchemaError).code).toBe('MP-SCHEMA-008');
    }
  });

  it('throws SchemaError when a field value is not a string', () => {
    try {
      parseEntitySchema('user', 'x', { amount: 1, data: { id: 42 } });
      expect.unreachable();
    } catch (error) {
      expect((error as SchemaError).code).toBe('MP-SCHEMA-009');
    }
  });

  it('propagates a typo suggestion from parseFieldType, with file/path location', () => {
    try {
      parseEntitySchema('user', 'mock/api/user/schema.json', { amount: 1, data: { email: 'emial' } });
      expect.unreachable();
    } catch (error) {
      const schemaError = error as SchemaError;
      expect(schemaError.hint).toContain('email');
      expect(schemaError.location).toEqual({ file: 'mock/api/user/schema.json', path: 'data.email' });
    }
  });

  it('throws SchemaError when "bypass" is not a boolean', () => {
    try {
      parseEntitySchema('user', 'x', { amount: 1, data: {}, bypass: 'yes' });
      expect.unreachable();
    } catch (error) {
      expect((error as SchemaError).code).toBe('MP-SCHEMA-012');
    }
  });
});
