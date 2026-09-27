/**
 * Legacy `api/<entity>/schema.json` → new format conversion, shared by
 * `mpug migrate` (rewrites files on disk) and the cloud `push` snapshot
 * (converts in memory before upload) so both produce an identical layout.
 * The 6-endpoint CRUD set here is the reference cloud's `defaultRoutes`
 * mirrors (SYNC-PLAN §1 #3): GET → `list`/`one`, create/update/delete →
 * `mutation` (a method map — 200, no store write).
 */

/** The table half of a legacy schema — data fields only, `bypass` dropped (it moves onto the endpoints). */
export function tableFrom(raw: Record<string, unknown>): Record<string, unknown> {
  const table: Record<string, unknown> = {};
  for (const key of ['amount', 'data', 'fixtures', 'literal'] as const) {
    if (key in raw) table[key] = raw[key];
  }
  return table;
}

/**
 * The endpoints a legacy `api/<entity>` table maps to. `bypass` (from the
 * table) is set on every one. A table with no `id` field gets only the
 * collection routes (`_list`, `_create`) — the `/:id` item routes would have
 * nothing to match on and doctor would flag them.
 */
export function crudRoutes(entity: string, bypass: boolean, hasId = true): Record<string, unknown>[] {
  const b = bypass ? { bypass: true } : {};
  const routes: Record<string, unknown>[] = [
    { id: `${entity}_list`, kind: 'list', method: 'GET', path: `/${entity}`, from: entity, ...b },
    { id: `${entity}_create`, kind: 'mutation', method: 'POST', path: `/${entity}`, from: entity, ...b },
  ];
  if (hasId) {
    routes.push(
      { id: `${entity}_get`, kind: 'one', method: 'GET', path: `/${entity}/:id`, from: entity, where: { id: ':id' }, ...b },
      { id: `${entity}_update`, kind: 'mutation', method: 'PUT', path: `/${entity}/:id`, from: entity, ...b },
      { id: `${entity}_patch`, kind: 'mutation', method: 'PATCH', path: `/${entity}/:id`, from: entity, ...b },
      { id: `${entity}_delete`, kind: 'mutation', method: 'DELETE', path: `/${entity}/:id`, from: entity, ...b },
    );
  }
  return routes;
}

/** Whether a raw legacy schema declares an `id` field (drives whether `/:id` routes are generated). */
export function hasIdField(raw: Record<string, unknown>): boolean {
  const data = raw.data;
  return typeof data === 'object' && data !== null && 'id' in (data as Record<string, unknown>);
}
