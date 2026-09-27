import { parseFieldValue } from './conditional.js';
import { topologicalOrder, type SchemaMap } from './dependencyGraph.js';
import { MockingpugError } from './errors.js';
import { ENTITY_NAME_RE } from './schemaDsl.js';
import type { SchemaSource } from './schemaOps.js';
import type { FieldSpec } from './types.js';

/**
 * One validation problem. Unlike the throwing validators
 * (`parseEntitySchema`, `validateEntitiesExist`) that stop at the first error,
 * {@link validateSchemas} collects every issue so a draft can show the full
 * list. Same data `mockingpug doctor --json` should emit, so CLI and cloud
 * report identically.
 */
export interface SchemaIssue {
  code: string;
  entity: string;
  field?: string;
  message: string;
  hint?: string;
}

export interface ValidateSchemasOptions {
  /** Custom dictionary names (from `mock/data/*.json`) that should parse as a `custom` generator rather than an unknown type. */
  knownCustomTypes?: readonly string[];
}

type CrossRef = Extract<FieldSpec, { kind: 'crossRef' }>;

/** Collects conditional `when`-order issues (a `when` field must exist and be declared earlier), recursing into nested branches. */
function checkConditionalOrder(field: string, spec: FieldSpec, fieldOrder: string[], entity: string, issues: SchemaIssue[]): void {
  if (spec.kind !== 'conditional') return;
  const selfIndex = fieldOrder.indexOf(field);
  for (const whenField of Object.keys(spec.when)) {
    const sourceIndex = fieldOrder.indexOf(whenField);
    if (sourceIndex === -1) {
      issues.push({ code: 'MP-SCHEMA-026', entity, field, message: `"when" references "${whenField}", which "${entity}" has no field named` });
    } else if (sourceIndex >= selfIndex) {
      issues.push({ code: 'MP-SCHEMA-027', entity, field, message: `"when" references "${whenField}", which must be declared earlier than "${field}"` });
    }
  }
  checkConditionalOrder(field, spec.then, fieldOrder, entity, issues);
  checkConditionalOrder(field, spec.else, fieldOrder, entity, issues);
}

/** The cross-ref a field carries, directly or as an array item (`array[data.tags.id].3`). */
function crossRefOf(spec: FieldSpec): CrossRef | undefined {
  if (spec.kind === 'crossRef') return spec;
  if (spec.kind === 'array' && spec.item.kind === 'crossRef') return spec.item;
  return undefined;
}

/** A bare relation (`data.orders`, no field): a read-time reverse list, never stored. */
const isInverseRef = (ref: CrossRef): boolean => ref.field === undefined && ref.fields === undefined && ref.rename === undefined;

/** Fields of `table` that hold a forward foreign key to `target`. */
function foreignKeysTo(parsed: SchemaMap, table: string, target: string): string[] {
  return Object.entries(parsed[table] ?? {})
    .filter(([, spec]) => spec.kind === 'crossRef' && spec.entity === target && !isInverseRef(spec))
    .map(([f]) => f);
}

/**
 * Every problem in a whole {@link SchemaSource} at once. Empty array ⇒ the
 * schema is valid and publishable; otherwise it lives as a draft. Covers DSL
 * parse errors (with "did you mean"), references to unknown entities/fields,
 * missing `slugify` sources, bad `amount`, empty `data`, invalid names, and
 * foreign-key cycles.
 */
export function validateSchemas(schema: SchemaSource, options: ValidateSchemasOptions = {}): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  const parsed: SchemaMap = {};
  const knownCustomTypes = options.knownCustomTypes ?? [];

  for (const [entity, table] of Object.entries(schema.tables)) {
    parsed[entity] = {};
    const { amount, data } = table;
    const fixtures = table.fixtures;

    if (!ENTITY_NAME_RE.test(entity)) {
      issues.push({ code: 'MP-VALID-001', entity, message: 'Table name: letters, digits and _ only, not starting with a digit' });
    }
    if (!Number.isInteger(amount) || amount < 0) {
      issues.push({ code: 'MP-VALID-002', entity, message: 'Records must be a whole number ≥ 0' });
    } else {
      if (fixtures && fixtures.length > amount) {
        issues.push({ code: 'MP-VALID-003', entity, message: `${fixtures.length} pinned rows but only ${amount} records` });
      }
      if (Array.isArray(table.literal) && table.literal.length > amount) {
        issues.push({ code: 'MP-SCHEMA-019', entity, message: `${table.literal.length} literal rows but only ${amount} records` });
      }
    }
    if (Object.keys(data).length === 0) {
      issues.push({ code: 'MP-VALID-004', entity, message: 'Add at least one field' });
    }

    const fieldOrder = Object.keys(data);
    for (const [field, dsl] of Object.entries(data)) {
      if (!ENTITY_NAME_RE.test(field)) {
        issues.push({ code: 'MP-VALID-005', entity, field, message: 'Field name: letters, digits and _ only, not starting with a digit' });
      }
      let spec: FieldSpec;
      try {
        spec = parseFieldValue(dsl, { knownCustomTypes }, entity);
      } catch (e) {
        if (e instanceof MockingpugError) {
          issues.push({ code: e.code, entity, field, message: e.reason, hint: e.hint });
        } else {
          issues.push({ code: 'MP-VALID-006', entity, field, message: (e as Error).message });
        }
        continue;
      }
      parsed[entity][field] = spec;

      const ref = crossRefOf(spec);
      if (ref) {
        const target = schema.tables[ref.entity];
        if (!target) {
          issues.push({ code: 'MP-DEP-001', entity, field, message: `Links to unknown table "${ref.entity}"` });
          continue;
        }
        if (ref.unique && Number.isInteger(amount) && Number.isInteger(target.amount) && amount > target.amount) {
          issues.push({
            code: 'MP-VALID-009',
            entity,
            field,
            message: `unique link needs a distinct "${ref.entity}" per record: ${amount} here but only ${target.amount} in "${ref.entity}"`,
          });
        }
        if (isInverseRef(ref)) {
          const back = foreignKeysTo(parsed, ref.entity, entity);
          // Only trust the count once the target's fields are parsed; if the target sorts later, recheck below.
          const backCount = back.length || countForwardKeys(schema, ref.entity, entity, knownCustomTypes);
          if (backCount === 0) {
            issues.push({
              code: 'MP-DEP-003',
              entity,
              field,
              message: `"data.${ref.entity}" is a reverse list, but "${ref.entity}" has no field linking back to "${entity}"`,
              hint: `for a link use "data.${ref.entity}.id"`,
            });
          } else if (backCount > 1) {
            issues.push({
              code: 'MP-DEP-004',
              entity,
              field,
              message: `Ambiguous reverse list: "${ref.entity}" links to "${entity}" via more than one field`,
            });
          }
        }
        for (const f of ref.fields ?? (ref.field ? [ref.field] : [])) {
          if (target.data[f] === undefined) {
            issues.push({ code: 'MP-VALID-007', entity, field, message: `"${ref.entity}" has no field "${f}"` });
          }
        }
      }
      if (spec.kind === 'slugify' && data[spec.field] === undefined) {
        issues.push({ code: 'MP-VALID-008', entity, field, message: `Slug source "${spec.field}" is not a field of "${entity}"` });
      }
      // Conditional `when` fields must exist and be declared earlier (MP-SCHEMA-026/027).
      checkConditionalOrder(field, spec, fieldOrder, entity, issues);
    }
  }

  // Foreign-key cycles (a → b → a) can't be generated; reuse the core graph check. Only meaningful once every field parsed.
  if (issues.length === 0) {
    try {
      topologicalOrder(parsed);
    } catch (e) {
      issues.push(
        e instanceof MockingpugError
          ? { code: e.code, entity: firstEntity(schema), message: e.reason, hint: e.hint }
          : { code: 'MP-DEP-002', entity: firstEntity(schema), message: (e as Error).message },
      );
    }
  }

  return issues;
}

/** Parses `source`'s forward FKs to `target` without a full parsed map (used when the target is validated after the source). */
function countForwardKeys(schema: SchemaSource, source: string, target: string, knownCustomTypes: readonly string[]): number {
  let count = 0;
  for (const dsl of Object.values(schema.tables[source]?.data ?? {})) {
    try {
      const spec = parseFieldValue(dsl, { knownCustomTypes });
      if (spec.kind === 'crossRef' && spec.entity === target && !isInverseRef(spec)) count++;
    } catch {
      // ignore unparseable siblings here; they surface as their own issue
    }
  }
  return count;
}

function firstEntity(schema: SchemaSource): string {
  return Object.keys(schema.tables)[0] ?? '';
}
