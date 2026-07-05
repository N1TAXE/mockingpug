import { describe, expect, it } from 'vitest';
import { assertSafeEntityName } from '../../src/store/adapter.js';
import { StoreError } from '../../src/core/index.js';

describe('assertSafeEntityName : path-traversal guard', () => {
  it('accepts normal entity names', () => {
    expect(() => assertSafeEntityName('user')).not.toThrow();
    expect(() => assertSafeEntityName('blog_post-2')).not.toThrow();
  });

  it('rejects path traversal attempts', () => {
    expect(() => assertSafeEntityName('../../etc/passwd')).toThrow(StoreError);
    expect(() => assertSafeEntityName('..')).toThrow(StoreError);
  });

  it('rejects path separators', () => {
    expect(() => assertSafeEntityName('user/admin')).toThrow(StoreError);
    expect(() => assertSafeEntityName('user\\admin')).toThrow(StoreError);
  });

  it('rejects an empty string', () => {
    expect(() => assertSafeEntityName('')).toThrow(StoreError);
  });
});
