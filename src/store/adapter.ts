import { StoreError } from '../core/index.js';
import type { EntityMeta } from './fingerprint.js';

export interface StoredRecord extends Record<string, unknown> {
  /** false for records added manually via a mutation, true for schema-generated ones. */
  _seed?: boolean;
  /**
   * Stable per-record generation index, assigned once at creation and never
   * reassigned, even if the record's position in the array shifts later
   * (e.g. trimming removes an earlier record). Field regeneration on
   * reconciliation (changed/added fields) keys its RNG off this, not off
   * array position, so results stay reproducible regardless of trimming.
   */
  _index?: number;
}

export interface StoredEntity {
  meta: EntityMeta;
  records: StoredRecord[];
}

/** Storage backend for generated/persisted entity data: memory or file. */
export interface StoreAdapter {
  load(entityName: string): Promise<StoredEntity | undefined>;
  save(entityName: string, data: StoredEntity): Promise<void>;
  /** Names of all entities currently persisted, used by orphan detection (§7 p.8). */
  listEntities(): Promise<string[]>;
  /** Removes a single entity's data, backs `mpug prune` (orphan cleanup, §7 p.8). No-op if it doesn't exist. */
  deleteEntity(entityName: string): Promise<void>;
  /** Wipes everything, backs `mpug reset`. */
  reset(): Promise<void>;
}

/** Only safe as a filename/store key: no path separators, no traversal, no hidden dotfiles. */
const SAFE_ENTITY_NAME = /^[A-Za-z0-9_-]+$/;

export function assertSafeEntityName(entityName: string): void {
  if (!SAFE_ENTITY_NAME.test(entityName)) {
    throw new StoreError(
      'MP-STORE-003',
      `invalid entity name "${entityName}"`,
      { hint: 'entity names may only contain letters, digits, "_" and "-"' },
    );
  }
}
