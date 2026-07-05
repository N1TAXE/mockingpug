export { safeMerge } from './safeMerge.js';

export { computeFieldFingerprint, computeEntityMeta, type EntityMeta } from './fingerprint.js';

export {
  planReconciliation,
  isNoopPlan,
  findOrphanEntities,
  type ReconciliationPlan,
} from './reconcile.js';

export {
  assertSafeEntityName,
  type StoreAdapter,
  type StoredEntity,
  type StoredRecord,
} from './adapter.js';

export { MemoryStoreAdapter } from './memoryAdapter.js';
export { FileStoreAdapter } from './fileAdapter.js';
