import { describe, expect, it } from 'vitest';
import { SchemaError } from '../../src/core/errors.js';
import { parseFieldType } from '../../src/core/parser.js';

describe('parseFieldType', () => {
  it('parses uuid', () => {
    expect(parseFieldType('uuid')).toEqual({ kind: 'uuid' });
  });

  it('parses number and number.increment', () => {
    expect(parseFieldType('number')).toEqual({ kind: 'number', mode: 'random' });
    expect(parseFieldType('number.increment')).toEqual({ kind: 'number', mode: 'increment' });
  });

  it('parses number.min-max ranges', () => {
    expect(parseFieldType('number.18-65')).toEqual({
      kind: 'number',
      mode: 'random',
      min: 18,
      max: 65,
    });
  });

  it('parses username.FS and username.NN', () => {
    expect(parseFieldType('username.FS')).toEqual({ kind: 'username', style: 'FS' });
    expect(parseFieldType('username.NN')).toEqual({ kind: 'username', style: 'NN' });
  });

  it('parses email with and without a fixed domain', () => {
    expect(parseFieldType('email')).toEqual({ kind: 'email', domain: undefined });
    expect(parseFieldType('email[gmail.com]')).toEqual({ kind: 'email', domain: 'gmail.com' });
  });

  it('parses hash variants', () => {
    expect(parseFieldType('hash')).toEqual({ kind: 'hash', algorithm: 'generic' });
    expect(parseFieldType('hash.md5')).toEqual({ kind: 'hash', algorithm: 'md5' });
    expect(parseFieldType('hash.sha256')).toEqual({ kind: 'hash', algorithm: 'sha256' });
  });

  it('parses lorem with and without a fixed length', () => {
    expect(parseFieldType('lorem')).toEqual({ kind: 'lorem', length: undefined });
    expect(parseFieldType('lorem.32')).toEqual({ kind: 'lorem', length: 32 });
  });

  it('parses date variants', () => {
    expect(parseFieldType('date')).toEqual({ kind: 'date', range: undefined });
    expect(parseFieldType('date.past')).toEqual({ kind: 'date', range: 'past' });
    expect(parseFieldType('date.future')).toEqual({ kind: 'date', range: 'future' });
  });

  it('parses boolean with an optional chance', () => {
    expect(parseFieldType('boolean')).toEqual({ kind: 'boolean', chance: undefined });
    expect(parseFieldType('boolean.0.8')).toEqual({ kind: 'boolean', chance: 0.8 });
  });

  it('parses inline enums', () => {
    expect(parseFieldType('enum[draft,published]')).toEqual({
      kind: 'enumInline',
      values: ['draft', 'published'],
    });
  });

  it('parses arrays of an inner type', () => {
    expect(parseFieldType('array[lorem.8].3')).toEqual({
      kind: 'array',
      item: { kind: 'lorem', length: 8 },
      count: 3,
    });
  });

  it('parses cross-entity references, with and without a field', () => {
    expect(parseFieldType('data.blogpost')).toEqual({ kind: 'crossRef', entity: 'blogpost' });
    expect(parseFieldType('data.user.id')).toEqual({
      kind: 'crossRef',
      entity: 'user',
      field: 'id',
    });
  });

  it('parses slugify[field,separator]', () => {
    expect(parseFieldType('slugify[title,-]')).toEqual({
      kind: 'slugify',
      field: 'title',
      separator: '-',
    });
  });

  it('parses slugify with an empty separator', () => {
    expect(parseFieldType('slugify[title,]')).toEqual({
      kind: 'slugify',
      field: 'title',
      separator: '',
    });
  });

  it('trims whitespace around slugify parts', () => {
    expect(parseFieldType('slugify[ title , _ ]')).toEqual({
      kind: 'slugify',
      field: 'title',
      separator: '_',
    });
  });

  it('throws SchemaError MP-SCHEMA-015 when slugify has the wrong number of parts', () => {
    try {
      parseFieldType('slugify[title]');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaError);
      expect((error as SchemaError).code).toBe('MP-SCHEMA-015');
    }
    try {
      parseFieldType('slugify[title,-,extra]');
      expect.unreachable();
    } catch (error) {
      expect((error as SchemaError).code).toBe('MP-SCHEMA-015');
    }
  });

  it('throws SchemaError MP-SCHEMA-015 when slugify has an empty field name', () => {
    try {
      parseFieldType('slugify[,-]');
      expect.unreachable();
    } catch (error) {
      expect((error as SchemaError).code).toBe('MP-SCHEMA-015');
    }
  });

  it('resolves a bare word to a custom type when it is registered', () => {
    expect(parseFieldType('role', { knownCustomTypes: ['role'] })).toEqual({
      kind: 'custom',
      name: 'role',
    });
  });

  it('throws SchemaError with code MP-SCHEMA-001 on an unknown type', () => {
    expect(() => parseFieldType('bogus')).toThrow(SchemaError);
    try {
      parseFieldType('bogus');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaError);
      expect((error as SchemaError).code).toBe('MP-SCHEMA-001');
    }
  });

  it('suggests the closest known type on a typo', () => {
    try {
      parseFieldType('emial[gmail.com]', { file: 'mock/api/user/schema.json', fieldPath: 'data.email' });
      expect.unreachable();
    } catch (error) {
      const schemaError = error as SchemaError;
      expect(schemaError.hint).toContain('email');
      expect(schemaError.location?.file).toBe('mock/api/user/schema.json');
      expect(schemaError.location?.path).toBe('data.email');
    }
  });

  it('suggests a registered custom type name on a typo', () => {
    try {
      parseFieldType('rol', { knownCustomTypes: ['role'] });
      expect.unreachable();
    } catch (error) {
      expect((error as SchemaError).hint).toContain('role');
    }
  });
});
