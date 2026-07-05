import { DependencyError, GenerationError } from './errors.js';
import { closestMatch } from './levenshtein.js';
import type { Rng } from './rng.js';
import { pick } from './rng.js';
import type { FieldSpec } from './types.js';

/** entityName -> fieldName -> parsed field spec. */
export type SchemaMap = Record<string, Record<string, FieldSpec>>;

interface FieldRef {
  sourceEntity: string;
  sourceField: string;
  targetEntity: string;
  targetField?: string;
}

/** Recursively visits a field spec, including nested `array` item specs. */
function walkFieldSpec(spec: FieldSpec, visit: (ref: FieldSpec & { kind: 'crossRef' }) => void): void {
  if (spec.kind === 'crossRef') {
    visit(spec);
  } else if (spec.kind === 'array') {
    walkFieldSpec(spec.item, visit);
  }
}

function collectRefs(schemas: SchemaMap): FieldRef[] {
  const refs: FieldRef[] = [];
  for (const [entity, fields] of Object.entries(schemas)) {
    for (const [fieldName, spec] of Object.entries(fields)) {
      walkFieldSpec(spec, (ref) => {
        refs.push({
          sourceEntity: entity,
          sourceField: fieldName,
          targetEntity: ref.entity,
          targetField: ref.field,
        });
      });
    }
  }
  return refs;
}

/**
 * Validates that every `data.<entity>(.field)` reference points at a schema
 * that actually exists, with a "did you mean" suggestion on typos
 *.
 */
export function validateEntitiesExist(schemas: SchemaMap): void {
  const knownEntities = Object.keys(schemas);
  for (const ref of collectRefs(schemas)) {
    if (!(ref.targetEntity in schemas)) {
      const suggestion = closestMatch(ref.targetEntity, knownEntities);
      throw new DependencyError(
        'MP-DEP-001',
        `"${ref.sourceEntity}.${ref.sourceField}" references unknown entity "${ref.targetEntity}"`,
        {
          location: { file: `mock/api/${ref.sourceEntity}/schema.json`, path: `data.${ref.sourceField}` },
          hint: suggestion ? `did you mean "data.${suggestion}${ref.targetField ? `.${ref.targetField}` : ''}"?` : undefined,
        },
      );
    }
  }
}

/**
 * Topological order in which entities' base fields must be generated so
 * that field-level cross-refs (`data.user.id`) can be resolved against
 * already-generated records. Bare entity refs (`data.blogpost`, no field)
 * are intentionally excluded from this graph: they're resolved lazily as a
 * read-time join (see {@link resolveInverseRelation}), so they impose no
 * generation-order constraint and cannot deadlock a cycle.
 *
 * Throws {@link DependencyError} (`MP-DEP-002`) if the field-ref graph is
 * cyclic, e.g. two entities whose id fields require each other.
 */
export function topologicalOrder(schemas: SchemaMap): string[] {
  const entities = Object.keys(schemas);
  const fieldRefs = collectRefs(schemas).filter((ref) => ref.targetField !== undefined);

  const inDegree = new Map<string, number>(entities.map((e) => [e, 0]));
  const edges = new Map<string, Set<string>>(entities.map((e) => [e, new Set()]));
  for (const ref of fieldRefs) {
    // ref.sourceEntity depends on ref.targetEntity being generated first.
    const alreadyEdge = edges.get(ref.targetEntity)!.has(ref.sourceEntity);
    if (!alreadyEdge && ref.targetEntity !== ref.sourceEntity) {
      edges.get(ref.targetEntity)!.add(ref.sourceEntity);
      inDegree.set(ref.sourceEntity, (inDegree.get(ref.sourceEntity) ?? 0) + 1);
    }
  }

  const queue = entities.filter((e) => inDegree.get(e) === 0);
  const order: string[] = [];
  while (queue.length > 0) {
    const entity = queue.shift()!;
    order.push(entity);
    for (const dependent of edges.get(entity)!) {
      const remaining = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, remaining);
      if (remaining === 0) queue.push(dependent);
    }
  }

  if (order.length !== entities.length) {
    const stuck = entities.filter((e) => !order.includes(e));
    throw new DependencyError(
      'MP-DEP-002',
      `unresolvable circular reference between entities: ${stuck.join(', ')}`,
      {
        hint:
          'field-level refs (e.g. "data.user.id") on both sides of a cycle can never be generated first: ' +
          'turn one side into a bare relation (e.g. "data.blogpost", no field) or break the cycle',
      },
    );
  }

  return order;
}

/** Picks a value for a field-level cross-ref (`data.user.id`) from already-generated target records. */
export function resolveFieldRef(
  targetEntity: string,
  targetField: string,
  targetRecords: readonly Record<string, unknown>[],
  rng: Rng,
): unknown {
  if (targetRecords.length === 0) {
    throw new GenerationError(
      'MP-GEN-004',
      `cannot resolve "data.${targetEntity}.${targetField}": entity "${targetEntity}" has no generated records yet`,
    );
  }
  const record = pick(rng, targetRecords);
  if (!(targetField in record)) {
    throw new GenerationError(
      'MP-GEN-005',
      `cannot resolve "data.${targetEntity}.${targetField}": field "${targetField}" does not exist on "${targetEntity}" records`,
    );
  }
  return record[targetField];
}

/**
 * Resolves a bare relation (`data.blogpost` on `user`, no field) as a
 * read-time join: finds the single field in `targetEntity`'s schema that is
 * a field-level cross-ref back to `sourceEntity`, then returns every
 * `targetRecords` entry whose value in that field equals `sourceRecordId`.
 * This is computed on demand, never materialized at generation time,
 * so it stays correct however many mutations happen later.
 */
export function resolveInverseRelation(
  sourceEntity: string,
  sourceRecordId: unknown,
  targetEntity: string,
  targetSchema: Record<string, FieldSpec>,
  targetRecords: readonly Record<string, unknown>[],
): Record<string, unknown>[] {
  const candidateFields: string[] = [];
  for (const [fieldName, spec] of Object.entries(targetSchema)) {
    if (spec.kind === 'crossRef' && spec.entity === sourceEntity && spec.field !== undefined) {
      candidateFields.push(fieldName);
    }
  }

  if (candidateFields.length === 0) {
    throw new DependencyError(
      'MP-DEP-003',
      `cannot resolve bare relation "data.${targetEntity}" on "${sourceEntity}": ` +
        `no field on "${targetEntity}" references "${sourceEntity}" back`,
      { hint: `add a field like "data.${sourceEntity}.id" to mock/api/${targetEntity}/schema.json` },
    );
  }
  if (candidateFields.length > 1) {
    throw new DependencyError(
      'MP-DEP-004',
      `ambiguous bare relation "data.${targetEntity}" on "${sourceEntity}": ` +
        `multiple fields on "${targetEntity}" reference "${sourceEntity}" back: ${candidateFields.join(', ')}`,
      { hint: 'use an explicit field-level ref (e.g. "data.user.id") instead of the bare form' },
    );
  }

  const fkField = candidateFields[0]!;
  return targetRecords.filter((record) => record[fkField] === sourceRecordId);
}
