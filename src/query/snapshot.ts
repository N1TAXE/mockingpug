import type { StoredEntity } from '../store/adapter.js';
import type { QueryContext } from './resolver.js';

/** `{ entity: { meta, records } }` for every entity currently in the store, as downloaded/uploaded by `<MockDevtools>`'s Export/Import buttons. */
export type StoreSnapshot = Record<string, StoredEntity>;

export async function exportSnapshot(ctx: QueryContext): Promise<StoreSnapshot> {
  const snapshot: StoreSnapshot = {};
  for (const entity of Object.keys(ctx.schemas)) {
    const stored = await ctx.store.load(entity);
    if (stored) snapshot[entity] = stored;
  }
  return snapshot;
}

/**
 * Restores entities from a previously exported snapshot via `store.save()`,
 * one entity at a time. Only keys matching a schema in `ctx.schemas` are
 * applied — an unrecognized entity name (e.g. a snapshot exported against a
 * different schema version) is silently skipped rather than writing
 * untracked data the rest of mockingpug (reconciliation, orphan detection)
 * doesn't know about.
 */
export async function importSnapshot(ctx: QueryContext, snapshot: StoreSnapshot): Promise<void> {
  for (const [entity, data] of Object.entries(snapshot)) {
    if (!(entity in ctx.schemas)) continue;
    await ctx.store.save(entity, data);
  }
}
