import { describe, expect, it } from 'vitest';
import { parseFieldType } from '../../src/core/parser.js';
import { stringifyFieldType } from '../../src/core/schemaDsl.js';
import { generateSample } from '../../src/core/generateSample.js';
import { validateSchemas, type SchemaSource } from '../../src/core/index.js';

describe('unique field-level ref (R10)', () => {
  it('parses data.<entity>.<field>!unique into a unique crossRef and round-trips', () => {
    const spec = parseFieldType('data.users.id!unique');
    expect(spec).toEqual({ kind: 'crossRef', entity: 'users', field: 'id', unique: true });
    expect(stringifyFieldType(spec)).toBe('data.users.id!unique');
  });

  it('rejects !unique on a bare relation (no field)', () => {
    expect(() => parseFieldType('data.users!unique')).toThrow(/!unique/);
  });

  it('assigns a distinct target to every source record', () => {
    const s: SchemaSource = {
      tables: {
        users: { amount: 5, data: { id: 'number.increment' } },
        profiles: { amount: 5, data: { id: 'uuid', userId: 'data.users.id!unique' } },
      },
    };
    const profiles = generateSample(s, 'profiles', { count: 5, seed: 's' });
    const userIds = profiles.map((p) => p.userId);
    expect(new Set(userIds).size).toBe(userIds.length); // all distinct
  });

  it('validateSchemas flags a unique link with fewer targets than sources (MP-VALID-009)', () => {
    const s: SchemaSource = {
      tables: {
        users: { amount: 3, data: { id: 'number.increment' } },
        profiles: { amount: 5, data: { id: 'uuid', userId: 'data.users.id!unique' } },
      },
    };
    expect(validateSchemas(s).some((i) => i.code === 'MP-VALID-009')).toBe(true);
  });

  it('validateSchemas accepts a unique link with enough targets', () => {
    const s: SchemaSource = {
      tables: {
        users: { amount: 5, data: { id: 'number.increment' } },
        profiles: { amount: 5, data: { id: 'uuid', userId: 'data.users.id!unique' } },
      },
    };
    expect(validateSchemas(s)).toEqual([]);
  });
});
