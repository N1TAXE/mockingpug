import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileStoreAdapter } from '../../src/store/fileAdapter.js';
import { StoreError } from '../../src/core/index.js';
import type { StoredEntity } from '../../src/store/adapter.js';

const sample: StoredEntity = {
  meta: { amount: 2, fieldsHash: { id: 'abc' }, fixturesHash: '0' },
  records: [{ id: 1, _seed: true }, { id: 2, _seed: true }],
};

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mockingpug-store-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('FileStoreAdapter', () => {
  it('returns undefined when no file exists yet for the entity', async () => {
    const store = new FileStoreAdapter(dir);
    expect(await store.load('user')).toBeUndefined();
  });

  it('round-trips saved data through the filesystem', async () => {
    const store = new FileStoreAdapter(dir);
    await store.save('user', sample);
    expect(await store.load('user')).toEqual(sample);
  });

  it('creates the base directory on first save if it does not exist', async () => {
    const nested = join(dir, 'nested', 'db');
    const store = new FileStoreAdapter(nested);
    await store.save('user', sample);
    expect(await store.load('user')).toEqual(sample);
  });

  it('throws StoreError (MP-STORE-001) on a corrupted JSON file', async () => {
    await writeFile(join(dir, 'user.json'), '{ not valid json', 'utf-8');
    const store = new FileStoreAdapter(dir);
    await expect(store.load('user')).rejects.toThrow(StoreError);
    try {
      await store.load('user');
      expect.unreachable();
    } catch (error) {
      expect((error as StoreError).code).toBe('MP-STORE-001');
    }
  });

  it('listEntities reflects .json files present in the base directory', async () => {
    const store = new FileStoreAdapter(dir);
    await store.save('user', sample);
    await store.save('blogpost', sample);
    expect((await store.listEntities()).sort()).toEqual(['blogpost', 'user']);
  });

  it('listEntities returns [] when the base directory does not exist yet', async () => {
    const store = new FileStoreAdapter(join(dir, 'never-created'));
    expect(await store.listEntities()).toEqual([]);
  });

  it('deleteEntity removes only the named entity\'s file', async () => {
    const store = new FileStoreAdapter(dir);
    await store.save('user', sample);
    await store.save('blogpost', sample);
    await store.deleteEntity('user');
    expect(await store.load('user')).toBeUndefined();
    expect(await store.load('blogpost')).toEqual(sample);
  });

  it('deleteEntity is a no-op when the file does not exist', async () => {
    const store = new FileStoreAdapter(dir);
    await expect(store.deleteEntity('never-existed')).resolves.toBeUndefined();
  });

  it('reset removes the whole base directory', async () => {
    const store = new FileStoreAdapter(dir);
    await store.save('user', sample);
    await store.reset();
    expect(await store.load('user')).toBeUndefined();
  });

  it('rejects entity names that would escape the base directory', async () => {
    const store = new FileStoreAdapter(dir);
    await expect(store.save('../escape', sample)).rejects.toThrow(StoreError);
  });

  it('wraps a non-ENOENT read failure (e.g. reading a directory) as StoreError MP-STORE-004', async () => {
    // Create "user.json" as a directory instead of a file, so readFile fails
    // with something other than ENOENT (EISDIR/EPERM depending on platform).
    await mkdir(join(dir, 'user.json'));
    const store = new FileStoreAdapter(dir);
    await expect(store.load('user')).rejects.toMatchObject({ code: 'MP-STORE-004' });
  });

  it('wraps a write failure as StoreError MP-STORE-002', async () => {
    // Point baseDir at an existing *file*: mkdir(baseDir, {recursive:true})
    // then fails because a file already occupies that path segment.
    const blockerFile = join(dir, 'blocker');
    await writeFile(blockerFile, 'not a directory', 'utf-8');
    const store = new FileStoreAdapter(join(blockerFile, 'nested'));
    await expect(store.save('user', sample)).rejects.toMatchObject({ code: 'MP-STORE-002' });
  });

  it('wraps a non-ENOENT listEntities failure as StoreError MP-STORE-004', async () => {
    const blockerFile = join(dir, 'not-a-dir');
    await writeFile(blockerFile, 'not a directory', 'utf-8');
    const store = new FileStoreAdapter(blockerFile);
    await expect(store.listEntities()).rejects.toMatchObject({ code: 'MP-STORE-004' });
  });
});
