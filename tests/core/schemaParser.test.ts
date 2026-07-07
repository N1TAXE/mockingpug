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

  it('parses "fixtures" as an array of literal record patches', () => {
    const schema = parseEntitySchema('category', 'x', {
      amount: 5,
      data: { id: 'uuid', name: 'lorem', slug: 'lorem' },
      fixtures: [{ name: 'VKontakte', slug: 'vk' }, { name: 'Steam', slug: 'steam-keys' }],
    });
    expect(schema.fixtures).toEqual([{ name: 'VKontakte', slug: 'vk' }, { name: 'Steam', slug: 'steam-keys' }]);
  });

  it('omits "fixtures" from the result when not specified', () => {
    const schema = parseEntitySchema('user', 'x', { amount: 1, data: { id: 'uuid' } });
    expect(schema.fixtures).toBeUndefined();
  });

  it('parses "slugify[field,separator]" referencing an earlier field', () => {
    const schema = parseEntitySchema('article', 'x', {
      amount: 5,
      data: { id: 'uuid', title: 'lorem.32', slug: 'slugify[title,-]' },
    });
    expect(schema.data.slug).toEqual({ kind: 'slugify', field: 'title', separator: '-' });
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

  it('throws SchemaError when "fixtures" is not an array', () => {
    try {
      parseEntitySchema('category', 'x', { amount: 5, data: {}, fixtures: 'nope' });
      expect.unreachable();
    } catch (error) {
      expect((error as SchemaError).code).toBe('MP-SCHEMA-013');
    }
  });

  it('throws SchemaError when a "fixtures" entry is not an object', () => {
    try {
      parseEntitySchema('category', 'x', { amount: 5, data: {}, fixtures: [{ slug: 'vk' }, 'nope'] });
      expect.unreachable();
    } catch (error) {
      expect((error as SchemaError).code).toBe('MP-SCHEMA-013');
    }
  });

  it('throws SchemaError when "fixtures" is longer than "amount"', () => {
    try {
      parseEntitySchema('category', 'x', {
        amount: 1,
        data: {},
        fixtures: [{ slug: 'vk' }, { slug: 'steam-keys' }],
      });
      expect.unreachable();
    } catch (error) {
      expect((error as SchemaError).code).toBe('MP-SCHEMA-014');
    }
  });

  it('throws SchemaError when "literal" is not an array', () => {
    try {
      parseEntitySchema('category', 'x', { amount: 5, data: {}, literal: 'nope' });
      expect.unreachable();
    } catch (error) {
      expect((error as SchemaError).code).toBe('MP-SCHEMA-018');
    }
  });

  it('throws SchemaError when a "literal" entry is not an object', () => {
    try {
      parseEntitySchema('category', 'x', { amount: 5, data: {}, literal: [{ id: 1 }, 'nope'] });
      expect.unreachable();
    } catch (error) {
      expect((error as SchemaError).code).toBe('MP-SCHEMA-018');
    }
  });

  it('throws SchemaError when "literal" is longer than "amount"', () => {
    try {
      parseEntitySchema('category', 'x', {
        amount: 1,
        data: {},
        literal: [{ id: 1 }, { id: 2 }],
      });
      expect.unreachable();
    } catch (error) {
      expect((error as SchemaError).code).toBe('MP-SCHEMA-019');
    }
  });

  it('parses a valid "literal" array onto the returned schema', () => {
    const schema = parseEntitySchema('category', 'x', {
      amount: 5,
      data: { id: 'number.increment' },
      literal: [{ id: 1, name: 'VKontakte' }],
    });
    expect(schema.literal).toEqual([{ id: 1, name: 'VKontakte' }]);
  });

  it('throws SchemaError MP-SCHEMA-016 when slugify references an unknown field', () => {
    try {
      parseEntitySchema('article', 'x', {
        amount: 5,
        data: { id: 'uuid', slug: 'slugify[title,-]' },
      });
      expect.unreachable();
    } catch (error) {
      expect((error as SchemaError).code).toBe('MP-SCHEMA-016');
    }
  });

  it('throws SchemaError MP-SCHEMA-017 when slugify references a field declared later', () => {
    try {
      parseEntitySchema('article', 'x', {
        amount: 5,
        data: { slug: 'slugify[title,-]', title: 'lorem.32' },
      });
      expect.unreachable();
    } catch (error) {
      expect((error as SchemaError).code).toBe('MP-SCHEMA-017');
    }
  });

  it('throws SchemaError MP-SCHEMA-017 on a slugify self-reference', () => {
    try {
      parseEntitySchema('article', 'x', {
        amount: 5,
        data: { slug: 'slugify[slug,-]' },
      });
      expect.unreachable();
    } catch (error) {
      expect((error as SchemaError).code).toBe('MP-SCHEMA-017');
    }
  });

  it('parses a correlated multi-field pick onto the returned schema', () => {
    const schema = parseEntitySchema('order', 'x', {
      amount: 5,
      data: { orderId: 'uuid', product: 'data.product.[id,name,slug]' },
    });
    expect(schema.data.product).toEqual({ kind: 'crossRef', entity: 'product', fields: ['id', 'name', 'slug'] });
  });

  it('throws SchemaError MP-SCHEMA-021 when a multi-pick collides with a regular field on the same entity', () => {
    try {
      parseEntitySchema('order', 'x', {
        amount: 5,
        data: { id: 'uuid', name: 'lorem', product: 'data.product.[id,name]' },
      });
      expect.unreachable();
    } catch (error) {
      expect((error as SchemaError).code).toBe('MP-SCHEMA-021');
    }
  });

  it('throws SchemaError MP-SCHEMA-021 when two multi-picks project the same field name', () => {
    try {
      parseEntitySchema('order', 'x', {
        amount: 5,
        data: {
          id: 'uuid',
          product: 'data.product.[id,name]',
          category: 'data.category.[id,slug]',
        },
      });
      expect.unreachable();
    } catch (error) {
      expect((error as SchemaError).code).toBe('MP-SCHEMA-021');
    }
  });

  it('parses a field-level cross-ref array item onto the returned schema', () => {
    const schema = parseEntitySchema('order', 'x', {
      amount: 5,
      data: { relatedProductIds: 'array[data.product.id].3' },
    });
    expect(schema.data.relatedProductIds).toEqual({
      kind: 'array',
      item: { kind: 'crossRef', entity: 'product', field: 'id' },
      count: 3,
    });
  });

  it('throws SchemaError MP-SCHEMA-022 when an array item is a bare relation', () => {
    try {
      parseEntitySchema('order', 'x', {
        amount: 5,
        data: { products: 'array[data.product].3' },
      });
      expect.unreachable();
    } catch (error) {
      expect((error as SchemaError).code).toBe('MP-SCHEMA-022');
    }
  });

  it('throws SchemaError MP-SCHEMA-022 when an array item is a multi-pick', () => {
    try {
      parseEntitySchema('order', 'x', {
        amount: 5,
        data: { products: 'array[data.product.[id,name]].3' },
      });
      expect.unreachable();
    } catch (error) {
      expect((error as SchemaError).code).toBe('MP-SCHEMA-022');
    }
  });

  it('parses a conditional field onto the returned schema', () => {
    const schema = parseEntitySchema('order', 'x', {
      amount: 5,
      data: {
        status: 'enum[scheduled,published]',
        publishedAt: { when: { status: 'scheduled' }, then: null, else: 'date.past' },
      },
    });
    expect(schema.data.publishedAt).toEqual({
      kind: 'conditional',
      when: { status: 'scheduled' },
      then: { kind: 'literal', value: null },
      else: { kind: 'date', range: 'past' },
    });
  });

  it('parses non-null JSON literal then/else branches', () => {
    const schema = parseEntitySchema('order', 'x', {
      amount: 5,
      data: {
        status: 'enum[a,b]',
        flag: { when: { status: 'a' }, then: true, else: 42 },
      },
    });
    expect(schema.data.flag).toEqual({
      kind: 'conditional',
      when: { status: 'a' },
      then: { kind: 'literal', value: true },
      else: { kind: 'literal', value: 42 },
    });
  });

  it('parses a nested conditional in a branch', () => {
    const schema = parseEntitySchema('order', 'x', {
      amount: 5,
      data: {
        status: 'enum[a,b,c]',
        note: {
          when: { status: 'a' },
          then: 'lorem.16',
          else: { when: { status: 'b' }, then: true, else: null },
        },
      },
    });
    expect(schema.data.note).toEqual({
      kind: 'conditional',
      when: { status: 'a' },
      then: { kind: 'lorem', length: 16 },
      else: {
        kind: 'conditional',
        when: { status: 'b' },
        then: { kind: 'literal', value: true },
        else: { kind: 'literal', value: null },
      },
    });
  });

  it('supports multiple keys in "when" (AND semantics)', () => {
    const schema = parseEntitySchema('order', 'x', {
      amount: 5,
      data: {
        status: 'enum[a,b]',
        kind: 'enum[x,y]',
        note: { when: { status: 'a', kind: 'x' }, then: 'lorem', else: null },
      },
    });
    expect((schema.data.note as { when: unknown }).when).toEqual({ status: 'a', kind: 'x' });
  });

  it('throws SchemaError MP-SCHEMA-023 when "when" is missing or empty', () => {
    try {
      parseEntitySchema('order', 'x', {
        amount: 5,
        data: { status: 'enum[a]', note: { when: {}, then: null, else: null } },
      });
      expect.unreachable();
    } catch (error) {
      expect((error as SchemaError).code).toBe('MP-SCHEMA-023');
    }
  });

  it('throws SchemaError MP-SCHEMA-023 when "then" or "else" is missing', () => {
    try {
      parseEntitySchema('order', 'x', {
        amount: 5,
        data: { status: 'enum[a]', note: { when: { status: 'a' }, then: null } },
      });
      expect.unreachable();
    } catch (error) {
      expect((error as SchemaError).code).toBe('MP-SCHEMA-023');
    }
  });

  it('throws SchemaError MP-SCHEMA-024 when a branch value has an unsupported type', () => {
    try {
      parseEntitySchema('order', 'x', {
        amount: 5,
        data: { status: 'enum[a]', note: { when: { status: 'a' }, then: [1, 2], else: null } },
      });
      expect.unreachable();
    } catch (error) {
      expect((error as SchemaError).code).toBe('MP-SCHEMA-024');
    }
  });

  it('throws SchemaError MP-SCHEMA-025 when a branch resolves to a bare relation', () => {
    try {
      parseEntitySchema('order', 'x', {
        amount: 5,
        data: { status: 'enum[a]', owner: { when: { status: 'a' }, then: 'data.user', else: null } },
      });
      expect.unreachable();
    } catch (error) {
      expect((error as SchemaError).code).toBe('MP-SCHEMA-025');
    }
  });

  it('throws SchemaError MP-SCHEMA-025 when a branch resolves to a multi-pick', () => {
    try {
      parseEntitySchema('order', 'x', {
        amount: 5,
        data: { status: 'enum[a]', product: { when: { status: 'a' }, then: 'data.product.[id,name]', else: null } },
      });
      expect.unreachable();
    } catch (error) {
      expect((error as SchemaError).code).toBe('MP-SCHEMA-025');
    }
  });

  it('throws SchemaError MP-SCHEMA-026 when "when" references an unknown field', () => {
    try {
      parseEntitySchema('order', 'x', {
        amount: 5,
        data: { status: 'enum[a]', note: { when: { sttaus: 'a' }, then: null, else: null } },
      });
      expect.unreachable();
    } catch (error) {
      expect((error as SchemaError).code).toBe('MP-SCHEMA-026');
    }
  });

  it('throws SchemaError MP-SCHEMA-027 when "when" references a field declared later', () => {
    try {
      parseEntitySchema('order', 'x', {
        amount: 5,
        data: { note: { when: { status: 'a' }, then: null, else: null }, status: 'enum[a]' },
      });
      expect.unreachable();
    } catch (error) {
      expect((error as SchemaError).code).toBe('MP-SCHEMA-027');
    }
  });

  it('throws SchemaError MP-SCHEMA-027 on a "when" self-reference', () => {
    try {
      parseEntitySchema('order', 'x', {
        amount: 5,
        data: { note: { when: { note: 'a' }, then: null, else: null } },
      });
      expect.unreachable();
    } catch (error) {
      expect((error as SchemaError).code).toBe('MP-SCHEMA-027');
    }
  });

  it('throws SchemaError MP-SCHEMA-027 when a nested conditional\'s "when" references a field declared later (outer "when" is valid)', () => {
    try {
      parseEntitySchema('order', 'x', {
        amount: 5,
        data: {
          a: 'number',
          note: { when: { a: 1 }, then: null, else: { when: { kind: 'x' }, then: null, else: null } },
          kind: 'enum[x]',
        },
      });
      expect.unreachable();
    } catch (error) {
      expect((error as SchemaError).code).toBe('MP-SCHEMA-027');
    }
  });
});
