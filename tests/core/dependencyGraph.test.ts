import { describe, expect, it } from 'vitest';
import {
  validateEntitiesExist,
  topologicalOrder,
  resolveFieldRef,
  resolveInverseRelation,
  type SchemaMap,
} from '../../src/core/dependencyGraph.js';
import { DependencyError, GenerationError } from '../../src/core/errors.js';
import { createRng } from '../../src/core/rng.js';
import type { FieldSpec } from '../../src/core/types.js';

const uuid: FieldSpec = { kind: 'uuid' };
const increment: FieldSpec = { kind: 'number', mode: 'increment' };
const lorem: FieldSpec = { kind: 'lorem' };

describe('dependencyGraph, real example from mock/api (user <-> blogpost)', () => {
  // Mirrors mock/api/user/schema.json (posts: "data.blogpost") and
  // mock/api/blogpost/schema.json (author: "data.user.id"), a bidirectional
  // relation that must NOT be treated as an unresolvable cycle.
  const schemas: SchemaMap = {
    user: {
      id: increment,
      name: lorem,
      posts: { kind: 'crossRef', entity: 'blogpost' },
    },
    blogpost: {
      id: uuid,
      title: lorem,
      author: { kind: 'crossRef', entity: 'user', field: 'id' },
    },
  };

  it('does not flag the bidirectional user/blogpost relation as a cycle', () => {
    expect(() => topologicalOrder(schemas)).not.toThrow();
  });

  it('orders "user" before "blogpost" since blogpost.author needs user.id', () => {
    const order = topologicalOrder(schemas);
    expect(order.indexOf('user')).toBeLessThan(order.indexOf('blogpost'));
  });

  it('validateEntitiesExist passes for this schema', () => {
    expect(() => validateEntitiesExist(schemas)).not.toThrow();
  });
});

describe('validateEntitiesExist', () => {
  it('throws DependencyError on a reference to an unknown entity', () => {
    const schemas: SchemaMap = {
      blogpost: { author: { kind: 'crossRef', entity: 'usre', field: 'id' } },
    };
    expect(() => validateEntitiesExist(schemas)).toThrow(DependencyError);
  });

  it('suggests the closest known entity name on a typo', () => {
    const schemas: SchemaMap = {
      user: { id: uuid },
      blogpost: { author: { kind: 'crossRef', entity: 'usre', field: 'id' } },
    };
    try {
      validateEntitiesExist(schemas);
      expect.unreachable();
    } catch (error) {
      expect((error as DependencyError).hint).toContain('user');
    }
  });
});

describe('topologicalOrder : genuine unresolvable cycles', () => {
  it('throws DependencyError when two entities require each other by field', () => {
    const schemas: SchemaMap = {
      a: { bRef: { kind: 'crossRef', entity: 'b', field: 'id' } },
      b: { aRef: { kind: 'crossRef', entity: 'a', field: 'id' } },
    };
    expect(() => topologicalOrder(schemas)).toThrow(DependencyError);
    try {
      topologicalOrder(schemas);
      expect.unreachable();
    } catch (error) {
      expect((error as DependencyError).code).toBe('MP-DEP-002');
    }
  });

  it('finds refs nested inside array item specs', () => {
    const schemas: SchemaMap = {
      user: { id: uuid },
      blogpost: {
        tags: { kind: 'array', item: { kind: 'crossRef', entity: 'user', field: 'id' }, count: 3 },
      },
    };
    const order = topologicalOrder(schemas);
    expect(order.indexOf('user')).toBeLessThan(order.indexOf('blogpost'));
  });
});

describe('resolveFieldRef', () => {
  it('returns the requested field from a random already-generated record', () => {
    const rng = createRng('s');
    const records = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const value = resolveFieldRef('user', 'id', records, rng);
    expect([1, 2, 3]).toContain(value);
  });

  it('throws GenerationError when the target entity has no records', () => {
    expect(() => resolveFieldRef('user', 'id', [], createRng('s'))).toThrow(GenerationError);
  });

  it('throws GenerationError when the field is missing on target records', () => {
    expect(() => resolveFieldRef('user', 'missingField', [{ id: 1 }], createRng('s'))).toThrow(
      GenerationError,
    );
  });
});

describe('resolveInverseRelation', () => {
  const blogpostSchema: Record<string, FieldSpec> = {
    id: uuid,
    author: { kind: 'crossRef', entity: 'user', field: 'id' },
  };

  it('returns only the target records whose fk field matches the source id (lazy join)', () => {
    const blogposts = [
      { id: 'p1', author: 1 },
      { id: 'p2', author: 2 },
      { id: 'p3', author: 1 },
    ];
    const result = resolveInverseRelation('user', 1, 'blogpost', blogpostSchema, blogposts);
    expect(result).toEqual([blogposts[0], blogposts[2]]);
  });

  it('throws DependencyError when no field on the target references back', () => {
    const schemaWithoutBackRef: Record<string, FieldSpec> = { id: uuid };
    expect(() =>
      resolveInverseRelation('user', 1, 'blogpost', schemaWithoutBackRef, []),
    ).toThrow(DependencyError);
  });

  it('throws DependencyError when multiple fields ambiguously reference back', () => {
    const ambiguousSchema: Record<string, FieldSpec> = {
      author: { kind: 'crossRef', entity: 'user', field: 'id' },
      reviewer: { kind: 'crossRef', entity: 'user', field: 'id' },
    };
    expect(() => resolveInverseRelation('user', 1, 'blogpost', ambiguousSchema, [])).toThrow(
      DependencyError,
    );
  });
});
