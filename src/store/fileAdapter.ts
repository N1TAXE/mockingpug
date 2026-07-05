import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { StoreError } from '../core/index.js';
import { assertSafeEntityName, type StoreAdapter, type StoredEntity } from './adapter.js';

/**
 * File-backed store under `<baseDir>/<entity>.json`: one JSON file per
 * entity, `{ meta, records }`. Needed wherever memory isn't
 * enough to survive a restart (Next.js serverless invocations don't share
 * memory) or mutations must persist across dev-server reloads.
 */
export class FileStoreAdapter implements StoreAdapter {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = resolve(baseDir);
  }

  private pathFor(entityName: string): string {
    assertSafeEntityName(entityName);
    return join(this.baseDir, `${entityName}.json`);
  }

  async load(entityName: string): Promise<StoredEntity | undefined> {
    const filePath = this.pathFor(entityName);
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new StoreError('MP-STORE-004', `failed to read store file for "${entityName}"`, {
        location: { file: filePath },
        cause: error,
      });
    }

    try {
      return JSON.parse(raw) as StoredEntity;
    } catch (error) {
      throw new StoreError('MP-STORE-001', `corrupted store file for "${entityName}": invalid JSON`, {
        location: { file: filePath },
        hint: 'delete this file (or run "mpug reset") to regenerate it from scratch',
        cause: error,
      });
    }
  }

  async save(entityName: string, data: StoredEntity): Promise<void> {
    const filePath = this.pathFor(entityName);
    try {
      await mkdir(this.baseDir, { recursive: true });
      await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      throw new StoreError('MP-STORE-002', `failed to write store file for "${entityName}"`, {
        location: { file: filePath },
        cause: error,
      });
    }
  }

  async listEntities(): Promise<string[]> {
    try {
      const files = await readdir(this.baseDir);
      return files.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -'.json'.length));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new StoreError('MP-STORE-004', 'failed to list store directory', {
        location: { file: this.baseDir },
        cause: error,
      });
    }
  }

  async deleteEntity(entityName: string): Promise<void> {
    const filePath = this.pathFor(entityName);
    await rm(filePath, { force: true });
  }

  async reset(): Promise<void> {
    await rm(this.baseDir, { recursive: true, force: true });
  }
}
