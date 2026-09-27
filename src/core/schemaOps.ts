import { relationTarget } from './schemaDsl.js';

/**
 * One table in the serializable, multi-entity schema the cloud stores and the
 * CLI syncs. `data` values are DSL strings (`"number.increment"`), the same
 * form `mock/api/<name>/schema.json` holds. `tables.<name>` ↔ that file.
 */
/** A field's raw value: a DSL string, or a `{when,then,else}` conditional object. */
export type FieldSource = string | Record<string, unknown>;

export interface TableSource {
  amount: number;
  data: Record<string, FieldSource>;
  /** Passed through untouched by operations. */
  fixtures?: Array<Record<string, unknown>>;
  literal?: Array<Record<string, unknown>>;
  /** Per-table bypass flag (moves to the endpoint under R5). Passed through untouched. */
  bypass?: boolean;
}

/**
 * A whole project's schema. `layout` (canvas x/y) is cloud-only UI metadata:
 * it never reaches `mock/`, but operations keep its keys in sync with the
 * tables so a rename/remove doesn't strand a coordinate.
 */
export interface SchemaSource {
  tables: Record<string, TableSource>;
  layout?: Record<string, { x: number; y: number }>;
}

/**
 * Serializable edits to a {@link SchemaSource} (the "operation layer", шов 2).
 * Canvas is the first client; AI, schema import, API kits and the CLI later
 * emit the same operations, so every editor mutates the schema one way.
 */
export type SchemaOp =
  | { type: 'table.add'; name: string; x: number; y: number; data?: Record<string, string>; amount?: number }
  | { type: 'table.rename'; from: string; to: string }
  | { type: 'table.remove'; name: string }
  | { type: 'table.move'; name: string; x: number; y: number }
  | { type: 'table.setAmount'; name: string; amount: number }
  | { type: 'field.add'; table: string; name: string; dsl: string }
  | { type: 'field.rename'; table: string; from: string; to: string }
  | { type: 'field.remove'; table: string; name: string }
  | { type: 'field.setDsl'; table: string; name: string; dsl: string };

/** Renames a key while keeping its position: field and table order is significant (it shows in API responses). */
function renameKey<T>(obj: Record<string, T>, from: string, to: string): Record<string, T> {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k === from ? to : k, v]));
}

function omitKey<T>(obj: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key));
}

/**
 * Rewrites a `data.<from>` reference to `data.<to>` inside one field value,
 * recursing into a conditional's `then`/`else` branches (which can themselves
 * hold cross-ref DSL). `when` literals are left alone. Non-relation strings
 * and non-conditional objects pass through unchanged.
 */
function rewriteFieldValue(value: FieldSource, from: string, to: string): FieldSource {
  if (typeof value === 'string') {
    return relationTarget(value) === from ? `data.${to}${value.slice(`data.${from}`.length)}` : value;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const next: Record<string, unknown> = { ...value };
    if ('then' in next) next.then = rewriteFieldValue(next.then as FieldSource, from, to);
    if ('else' in next) next.else = rewriteFieldValue(next.else as FieldSource, from, to);
    return next;
  }
  return value;
}

function mapTable(schema: SchemaSource, name: string, fn: (t: TableSource) => TableSource): SchemaSource {
  const table = schema.tables[name];
  if (!table) return schema;
  return { ...schema, tables: { ...schema.tables, [name]: fn(table) } };
}

/**
 * Applies one operation without mutating the input. An impossible operation
 * (missing table, name already taken) returns the schema unchanged — the UI
 * won't offer it, and the server validates the whole result anyway. `rename`
 * of an entity rewrites every `data.<from>`, `data.<from>.<field>` and
 * `data.<from>.[...]` reference to point at the new name.
 */
export function applyOp(schema: SchemaSource, op: SchemaOp): SchemaSource {
  const { tables } = schema;
  const layout = schema.layout ?? {};

  switch (op.type) {
    case 'table.add':
      if (tables[op.name]) return schema;
      return {
        tables: { ...tables, [op.name]: { amount: op.amount ?? 10, data: op.data ?? { id: 'number.increment' } } },
        layout: { ...layout, [op.name]: { x: op.x, y: op.y } },
      };

    case 'table.rename': {
      if (!tables[op.from] || tables[op.to] || op.from === op.to) return schema;
      const renamed = Object.fromEntries(
        Object.entries(renameKey(tables, op.from, op.to)).map(([name, t]) => [
          name,
          {
            ...t,
            data: Object.fromEntries(
              Object.entries(t.data).map(([f, value]) => [f, rewriteFieldValue(value, op.from, op.to)]),
            ),
          },
        ]),
      );
      return { tables: renamed, layout: renameKey(layout, op.from, op.to) };
    }

    case 'table.remove':
      return { tables: omitKey(tables, op.name), layout: omitKey(layout, op.name) };

    case 'table.move':
      if (!tables[op.name]) return schema;
      return { ...schema, layout: { ...layout, [op.name]: { x: op.x, y: op.y } } };

    case 'table.setAmount':
      return mapTable(schema, op.name, (t) => ({ ...t, amount: op.amount }));

    case 'field.add':
      return mapTable(schema, op.table, (t) =>
        t.data[op.name] !== undefined ? t : { ...t, data: { ...t.data, [op.name]: op.dsl } },
      );

    case 'field.rename':
      return mapTable(schema, op.table, (t) =>
        t.data[op.from] === undefined || t.data[op.to] !== undefined
          ? t
          : { ...t, data: renameKey(t.data, op.from, op.to) },
      );

    case 'field.remove':
      return mapTable(schema, op.table, (t) => ({ ...t, data: omitKey(t.data, op.name) }));

    case 'field.setDsl':
      return mapTable(schema, op.table, (t) =>
        t.data[op.name] === undefined ? t : { ...t, data: { ...t.data, [op.name]: op.dsl } },
      );
  }
}

/** A free name of the form base, base_2, base_3… given the taken ones. */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  let i = 2;
  while (set.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}
