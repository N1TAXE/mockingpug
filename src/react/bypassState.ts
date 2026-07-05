/**
 * Runtime bypass state: a per-tab singleton `Set` of entity
 * names currently opted out of mocking. `mockingpug.bypass('user')` lets a
 * specific entity's real backend answer (via MSW's `passthrough()`) while
 * everything else stays mocked, without restarting the worker or touching
 * the schema file. Complements (doesn't replace) the static, schema-level
 * `EntitySchema.bypass` flag; either one is enough to bypass an entity.
 */
const bypassedEntities = new Set<string>();

export function bypass(entity: string): void {
  bypassedEntities.add(entity);
}

export function unbypass(entity: string): void {
  bypassedEntities.delete(entity);
}

export function isRuntimeBypassed(entity: string): boolean {
  return bypassedEntities.has(entity);
}

/** Test-only: clears all runtime bypass state so test cases don't leak into each other. */
export function resetBypassState(): void {
  bypassedEntities.clear();
}
