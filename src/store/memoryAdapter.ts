import { assertSafeEntityName, type StoreAdapter, type StoredEntity } from './adapter.js';

/** In-process store, no persistence across restarts. */
export class MemoryStoreAdapter implements StoreAdapter {
  private readonly entities = new Map<string, StoredEntity>();

  async load(entityName: string): Promise<StoredEntity | undefined> {
    assertSafeEntityName(entityName);
    const entry = this.entities.get(entityName);
    return entry ? structuredClone(entry) : undefined;
  }

  async save(entityName: string, data: StoredEntity): Promise<void> {
    assertSafeEntityName(entityName);
    this.entities.set(entityName, structuredClone(data));
  }

  async listEntities(): Promise<string[]> {
    return [...this.entities.keys()];
  }

  async deleteEntity(entityName: string): Promise<void> {
    assertSafeEntityName(entityName);
    this.entities.delete(entityName);
  }

  async reset(): Promise<void> {
    this.entities.clear();
  }
}
