import type { FieldSpec } from './types.js';
import { expandDataFields } from './expandFields.js';
import { expandRoutePaths, type Include, type Route, type Where } from './routes.js';

/** A single problem found in the endpoint definitions, mirroring `SchemaIssue` from {@link validateSchemas}. */
export interface RouteIssue {
  code: string;
  route: string;
  message: string;
}

/** Minimal table shape the route validator needs — just each table's field map. */
export interface TableFields {
  data: Record<string, FieldSpec>;
}

function pathParams(path: string): string[] {
  return path
    .split('/')
    .filter((s) => s.startsWith(':'))
    .map((s) => s.slice(1));
}

/** The `:param` names a `where` clause references (values like `":id"`). */
function whereParamRefs(where: Where): string[] {
  const refs: string[] = [];
  for (const value of Object.values(where)) {
    if (typeof value === 'string' && value.startsWith(':')) refs.push(value.slice(1));
  }
  return refs;
}

/** Output field names a table actually produces (multi-pick / renamed refs expand; nested objects keep their key). */
function outputFields(table: TableFields): Set<string> {
  return new Set(expandDataFields(table.data).map(([name]) => name));
}

function checkWhere(id: string, from: string, where: Where | undefined, table: TableFields, params: string[], issues: RouteIssue[]): void {
  if (!where) return;
  const fields = outputFields(table);
  for (const [field, value] of Object.entries(where)) {
    if (!fields.has(field)) {
      issues.push({ code: 'MP-ROUTE-012', route: id, message: `"where" field "${field}" does not exist on table "${from}"` });
    }
    if (typeof value === 'string' && value.startsWith(':') && !params.includes(value.slice(1))) {
      issues.push({ code: 'MP-ROUTE-012', route: id, message: `"where.${field}" binds ":${value.slice(1)}" but the path has no such parameter` });
    }
  }
}

/** Whether a (possibly dotted) select path resolves through the table's fields — descending into `object` fields for each segment. */
function selectPathExists(data: Record<string, FieldSpec>, path: string): boolean {
  const parts = path.split('.');
  let fields = data;
  for (let i = 0; i < parts.length; i++) {
    const spec = fields[parts[i]!];
    if (!spec) return false;
    if (i === parts.length - 1) return true;
    if (spec.kind !== 'object') return false;
    fields = spec.fields;
  }
  return true;
}

function checkSelect(id: string, from: string, select: string[] | undefined, table: TableFields, issues: RouteIssue[]): void {
  if (!select) return;
  const fields = outputFields(table);
  for (const field of select) {
    // A plain name checks the output field set (covers renamed/multi-pick refs);
    // a dotted path descends through nested `object` fields.
    const ok = field.includes('.') ? selectPathExists(table.data, field) : fields.has(field);
    if (!ok) {
      issues.push({ code: 'MP-ROUTE-013', route: id, message: `"select" field "${field}" does not exist on table "${from}"` });
    }
  }
}

function checkInclude(id: string, from: string, include: Include | undefined, table: TableFields, tables: Record<string, TableFields>, issues: RouteIssue[]): void {
  if (!include) return;
  for (const [key, spec] of Object.entries(include)) {
    if (typeof spec === 'string') {
      const fk = table.data[spec];
      if (!fk || fk.kind !== 'crossRef') {
        issues.push({ code: 'MP-ROUTE-014', route: id, message: `include "${key}" points at "${spec}", which is not a relation field on table "${from}"` });
      }
    } else {
      const target = tables[spec.from];
      if (!target) {
        issues.push({ code: 'MP-ROUTE-014', route: id, message: `include "${key}" references unknown table "${spec.from}"` });
      } else if (!outputFields(target).has(spec.by)) {
        issues.push({ code: 'MP-ROUTE-014', route: id, message: `include "${key}" references field "${spec.by}" not on table "${spec.from}"` });
      } else if (spec.include) {
        // Validate the nested include against the target table.
        checkInclude(id, spec.from, spec.include, target, tables, issues);
      }
    }
  }
}

/**
 * Static checks over the endpoint definitions (R5 §9), the route-side companion
 * to {@link validateSchemas}: tables/fields/relations referenced by `from`,
 * `where`, `select`, `include` exist; every path `:param` is actually used
 * (list/one); no two routes answer the same method+path; `mutation` `body`/
 * `response` are valid JSON. Browser-safe — cloud runs the same checks.
 */
export function validateRoutes(routes: readonly Route[], tables: Record<string, TableFields>): RouteIssue[] {
  const issues: RouteIssue[] = [];

  // Method + path conflicts (a resource fans out to several concrete paths).
  const owners = new Map<string, string[]>();
  for (const route of routes) {
    for (const { method, path } of expandRoutePaths([route])) {
      const key = `${method} ${path}`;
      owners.set(key, [...(owners.get(key) ?? []), route.id]);
    }
  }
  for (const [key, ids] of owners) {
    if (ids.length > 1) {
      issues.push({ code: 'MP-ROUTE-010', route: ids.join(', '), message: `${ids.length} routes answer the same "${key}": ${ids.join(', ')}` });
    }
  }

  for (const route of routes) {
    if (route.kind === 'resource') continue; // auto-generated from an existing table; nothing to check

    if (route.kind === 'action') {
      const seenRefs = new Set<string>();
      for (const effect of route.effects) {
        const table = tables[effect.table];
        if (!table) {
          issues.push({ code: 'MP-ROUTE-011', route: route.id, message: `effect "${effect.op}" targets unknown table "${effect.table}"` });
        } else if (effect.op === 'increment' && !(effect.field in table.data)) {
          issues.push({ code: 'MP-ROUTE-013', route: route.id, message: `increment effect field "${effect.field}" does not exist on table "${effect.table}"` });
        }
        // A `$ref.<name>` binding must point at an effect that ran earlier.
        const bindings = [...Object.values('where' in effect ? effect.where : {}), ...Object.values('set' in effect && effect.set ? effect.set : {})];
        for (const v of bindings) {
          if (typeof v === 'string' && v.startsWith('$ref.')) {
            const name = v.slice(5).split('.')[0]!;
            if (!seenRefs.has(name)) issues.push({ code: 'MP-ROUTE-019', route: route.id, message: `effect references "$ref.${name}" before any effect named "${name}" ran` });
          }
        }
        if (effect.name) seenRefs.add(effect.name);
      }
      const respond = route.respond;
      if ('from' in respond && !tables[respond.from]) {
        issues.push({ code: 'MP-ROUTE-011', route: route.id, message: `respond "from" references unknown table "${respond.from}"` });
      } else if ('ref' in respond && !seenRefs.has(respond.ref)) {
        issues.push({ code: 'MP-ROUTE-019', route: route.id, message: `respond references "$ref.${respond.ref}" but no effect is named "${respond.ref}"` });
      }
      continue;
    }

    if (route.kind === 'composite') {
      const params = pathParams(route.path);
      for (const [key, slot] of Object.entries(route.shape)) {
        const slotId = `${route.id}.${key}`;
        const table = tables[slot.from];
        if (!table) {
          issues.push({ code: 'MP-ROUTE-011', route: slotId, message: `shape "${key}" "from" references unknown table "${slot.from}"` });
          continue;
        }
        checkWhere(slotId, slot.from, slot.where, table, params, issues);
        checkSelect(slotId, slot.from, slot.select, table, issues);
        checkInclude(slotId, slot.from, slot.include, table, tables, issues);
      }
      continue;
    }

    const params = pathParams(route.path);

    if (route.kind === 'mutation') {
      for (const key of ['body', 'response'] as const) {
        const raw = route[key];
        if (raw === undefined) continue;
        try {
          JSON.parse(raw);
        } catch {
          issues.push({ code: 'MP-ROUTE-015', route: route.id, message: `"${key}" is not valid JSON` });
        }
      }
    }

    // Table-backed kinds: from/where/select/include must line up with the schema.
    if (route.kind === 'list' || route.kind === 'one' || route.kind === 'mutation') {
      if (route.from === undefined) continue; // mutation without a table: nothing to resolve
      const table = tables[route.from];
      if (!table) {
        issues.push({ code: 'MP-ROUTE-011', route: route.id, message: `"from" references unknown table "${route.from}"` });
        continue;
      }
      if (route.kind !== 'mutation') {
        checkWhere(route.id, route.from, route.where, table, params, issues);
        checkInclude(route.id, route.from, route.include, table, tables, issues);
        // Every path param should be consumed by the where clause (else it does nothing).
        const used = new Set(route.where ? whereParamRefs(route.where) : []);
        for (const param of params) {
          if (!used.has(param)) {
            issues.push({ code: 'MP-ROUTE-016', route: route.id, message: `path parameter ":${param}" is never used in "where"` });
          }
        }
      }
      if (route.kind === 'list' && route.sort) {
        for (const clause of route.sort.split(',').map((c) => c.trim()).filter(Boolean)) {
          const field = clause.startsWith('-') ? clause.slice(1) : clause.split(':')[0]!;
          if (!(field in table.data)) {
            issues.push({ code: 'MP-ROUTE-018', route: route.id, message: `"sort" field "${field}" does not exist on table "${route.from}"` });
          }
        }
      }
      if (route.kind === 'list' && route.paginate) {
        for (const key of ['defaultLimit', 'maxLimit'] as const) {
          const n = route.paginate[key];
          if (n !== undefined && (!Number.isInteger(n) || n <= 0)) {
            issues.push({ code: 'MP-ROUTE-017', route: route.id, message: `"paginate.${key}" must be a positive integer` });
          }
        }
      }
      checkSelect(route.id, route.from, route.select, table, issues);
    }
  }

  return issues;
}
