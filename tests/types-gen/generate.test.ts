import { describe, expect, it } from 'vitest';
import { generateTypeDefinitions } from '../../src/types-gen/generate.js';
import type { EntitySchema } from '../../src/core/types.js';

describe('generateTypeDefinitions : field type mapping', () => {
  it('maps every scalar generator kind to its TS primitive', () => {
    const schemas: Record<string, EntitySchema> = {
      user: {
        name: 'user',
        file: 'x',
        amount: 1,
        data: {
          id: { kind: 'uuid' },
          age: { kind: 'number', mode: 'random' },
          login: { kind: 'username', style: 'FS' },
          email: { kind: 'email' },
          password: { kind: 'hash', algorithm: 'generic' },
          bio: { kind: 'lorem' },
          createdAt: { kind: 'date' },
          isActive: { kind: 'boolean' },
        },
      },
    };
    const output = generateTypeDefinitions(schemas);
    expect(output).toContain('export interface User {');
    expect(output).toContain('id: string;');
    expect(output).toContain('age: number;');
    expect(output).toContain('login: string;');
    expect(output).toContain('email: string;');
    expect(output).toContain('password: string;');
    expect(output).toContain('bio: string;');
    expect(output).toContain('createdAt: string;');
    expect(output).toContain('isActive: boolean;');
  });

  it('renders an inline enum as a string literal union', () => {
    const schemas: Record<string, EntitySchema> = {
      user: { name: 'user', file: 'x', amount: 1, data: { role: { kind: 'enumInline', values: ['ADMIN', 'USER'] } } },
    };
    expect(generateTypeDefinitions(schemas)).toContain("role: \"ADMIN\" | \"USER\";");
  });

  it('renders an array field as Array<T>, recursing into the item type', () => {
    const schemas: Record<string, EntitySchema> = {
      user: {
        name: 'user',
        file: 'x',
        amount: 1,
        data: { tags: { kind: 'array', item: { kind: 'lorem' }, count: 3 } },
      },
    };
    expect(generateTypeDefinitions(schemas)).toContain('tags: Array<string>;');
  });

  it('renders an all-string-literal custom dictionary as a union', () => {
    const schemas: Record<string, EntitySchema> = {
      user: { name: 'user', file: 'x', amount: 1, data: { role: { kind: 'custom', name: 'role' } } },
    };
    const customDictionaries = { role: [{ value: 'ADMIN', max: 5 }, { value: 'USER', chance: 0.9 }] };
    expect(generateTypeDefinitions(schemas, customDictionaries)).toContain("role: \"ADMIN\" | \"USER\";");
  });

  it('falls back to string for a custom dictionary with non-primitive values', () => {
    const schemas: Record<string, EntitySchema> = {
      user: { name: 'user', file: 'x', amount: 1, data: { config: { kind: 'custom', name: 'config' } } },
    };
    const customDictionaries = { config: [{ value: { nested: true } }] };
    expect(generateTypeDefinitions(schemas, customDictionaries)).toContain('config: string;');
  });

  it('falls back to string for a custom dictionary that is missing entirely', () => {
    const schemas: Record<string, EntitySchema> = {
      user: { name: 'user', file: 'x', amount: 1, data: { role: { kind: 'custom', name: 'role' } } },
    };
    expect(generateTypeDefinitions(schemas)).toContain('role: string;');
  });

  it('renders a bare (fieldless) cross-entity relation as ResolvedEntity[]', () => {
    const schemas: Record<string, EntitySchema> = {
      user: { name: 'user', file: 'x', amount: 1, data: { posts: { kind: 'crossRef', entity: 'blogpost' } } },
      blogpost: { name: 'blogpost', file: 'x', amount: 1, data: { id: { kind: 'uuid' } } },
    };
    expect(generateTypeDefinitions(schemas)).toContain('posts: Blogpost[];');
  });

  it('renders a field-level cross-entity relation as the target field\'s own type', () => {
    const schemas: Record<string, EntitySchema> = {
      blogpost: { name: 'blogpost', file: 'x', amount: 1, data: { author: { kind: 'crossRef', entity: 'user', field: 'id' } } },
      user: { name: 'user', file: 'x', amount: 1, data: { id: { kind: 'number', mode: 'increment' } } },
    };
    expect(generateTypeDefinitions(schemas)).toContain('author: number;');
  });

  it('falls back gracefully when a cross-reference points at an unknown entity (no schema validation done)', () => {
    const schemas: Record<string, EntitySchema> = {
      user: { name: 'user', file: 'x', amount: 1, data: { posts: { kind: 'crossRef', entity: 'ghost' } } },
    };
    expect(generateTypeDefinitions(schemas)).toContain('posts: unknown[];');
  });

  it('does not hang on a field-level cross-reference cycle', () => {
    const schemas: Record<string, EntitySchema> = {
      a: { name: 'a', file: 'x', amount: 1, data: { bRef: { kind: 'crossRef', entity: 'b', field: 'aRef' } } },
      b: { name: 'b', file: 'x', amount: 1, data: { aRef: { kind: 'crossRef', entity: 'a', field: 'bRef' } } },
    };
    expect(() => generateTypeDefinitions(schemas)).not.toThrow();
  });

  it('quotes a field name that is not a valid JS identifier', () => {
    const schemas: Record<string, EntitySchema> = {
      user: { name: 'user', file: 'x', amount: 1, data: { 'first-name': { kind: 'lorem' } } },
    };
    expect(generateTypeDefinitions(schemas)).toContain('"first-name": string;');
  });

  it('PascalCases hyphenated/underscored entity names for the interface name', () => {
    const schemas: Record<string, EntitySchema> = {
      'blog-post': { name: 'blog-post', file: 'x', amount: 1, data: { id: { kind: 'uuid' } } },
    };
    expect(generateTypeDefinitions(schemas)).toContain('export interface BlogPost {');
  });
});

describe('generateTypeDefinitions : full output (the real mock/ user+blogpost+role example)', () => {
  it('matches the expected generated source exactly', () => {
    const schemas: Record<string, EntitySchema> = {
      user: {
        name: 'user',
        file: 'mock/api/user/schema.json',
        amount: 1000,
        data: {
          id: { kind: 'number', mode: 'increment' },
          name: { kind: 'username', style: 'FS' },
          email: { kind: 'email', domain: 'gmail.com' },
          role: { kind: 'custom', name: 'role' },
          posts: { kind: 'crossRef', entity: 'blogpost' },
        },
      },
      blogpost: {
        name: 'blogpost',
        file: 'mock/api/blogpost/schema.json',
        amount: 1000,
        data: {
          id: { kind: 'uuid' },
          title: { kind: 'lorem', length: 32 },
          author: { kind: 'crossRef', entity: 'user', field: 'id' },
        },
      },
    };
    const customDictionaries = {
      role: [
        { value: 'ADMIN', max: 5 },
        { value: 'USER', chance: 0.9 },
        { value: 'MODER', chance: 0.2 },
      ],
    };

    const output = generateTypeDefinitions(schemas, customDictionaries);

    expect(output).toBe(
      [
        '// AUTO-GENERATED by `mpug types`. Do not edit by hand.',
        '// Regenerate with `npx mpug types` after changing mock/api/**.',
        '',
        'export interface Blogpost {',
        '  id: string;',
        '  title: string;',
        '  author: number;',
        '}',
        '',
        'export interface User {',
        '  id: number;',
        '  name: string;',
        '  email: string;',
        '  role: "ADMIN" | "USER" | "MODER";',
        '  posts: Blogpost[];',
        '}',
        '',
      ].join('\n'),
    );
  });
});
