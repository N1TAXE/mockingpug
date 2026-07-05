import type { EntityMeta } from './fingerprint.js';

/**
 * Pure decision output of comparing a previously stored entity snapshot
 * against the entity's current schema, used by `strategy: 'always'`.
 * Carries no side effects; applying it (generating/trimming/backfilling
 * actual records) is the caller's job.
 */
export interface ReconciliationPlan {
  /** No prior snapshot existed: generate the entity from scratch. */
  isNewEntity: boolean;
  /** `amount(new) - amount(old)`. Positive => append this many records, negative => trim. */
  amountDelta: number;
  /** Fields present now but absent from the stored snapshot: backfill on every existing record. */
  addedFields: string[];
  /** Fields that existed before but are no longer in the schema: strip from every record. */
  removedFields: string[];
  /** Fields whose type/params changed: regenerate only this field on every existing record. */
  changedFields: string[];
  /** Fields whose spec is byte-for-byte the same: leave untouched. */
  unchangedFields: string[];
}

export function planReconciliation(
  previous: EntityMeta | undefined,
  current: EntityMeta,
): ReconciliationPlan {
  const currentFields = Object.keys(current.fieldsHash);

  if (previous === undefined) {
    return {
      isNewEntity: true,
      amountDelta: current.amount,
      addedFields: currentFields,
      removedFields: [],
      changedFields: [],
      unchangedFields: [],
    };
  }

  const addedFields: string[] = [];
  const changedFields: string[] = [];
  const unchangedFields: string[] = [];

  for (const field of currentFields) {
    const previousHash = previous.fieldsHash[field];
    if (previousHash === undefined) {
      addedFields.push(field);
    } else if (previousHash !== current.fieldsHash[field]) {
      changedFields.push(field);
    } else {
      unchangedFields.push(field);
    }
  }

  const removedFields = Object.keys(previous.fieldsHash).filter(
    (field) => !(field in current.fieldsHash),
  );

  return {
    isNewEntity: false,
    amountDelta: current.amount - previous.amount,
    addedFields,
    removedFields,
    changedFields,
    unchangedFields,
  };
}

/** True if nothing at all changed; caller can skip regeneration entirely. */
export function isNoopPlan(plan: ReconciliationPlan): boolean {
  return (
    !plan.isNewEntity &&
    plan.amountDelta === 0 &&
    plan.addedFields.length === 0 &&
    plan.removedFields.length === 0 &&
    plan.changedFields.length === 0
  );
}

/**
 * Entities that exist in the persisted store but no longer have a matching
 * schema file: flagged, never auto-deleted. Clean up via
 * `mpug prune`.
 */
export function findOrphanEntities(
  storedEntityNames: readonly string[],
  currentEntityNames: readonly string[],
): string[] {
  const current = new Set(currentEntityNames);
  return storedEntityNames.filter((name) => !current.has(name));
}
