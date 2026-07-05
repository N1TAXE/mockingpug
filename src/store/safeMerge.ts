/**
 * Merges an untrusted `patch` (e.g. a request body) into `target` without
 * ever letting `__proto__`/`constructor`/`prototype` keys reach a property
 * assignment. Plain `{...target, ...patch}` is NOT safe:
 * assigning through the `__proto__` accessor on a plain object mutates its
 * prototype, so those keys must be dropped *before* any assignment happens,
 * not filtered out afterwards.
 */

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function safeMerge<T extends Record<string, unknown>>(
  target: T,
  patch: Record<string, unknown>,
): T {
  const result: Record<string, unknown> = { ...target };

  for (const key of Object.keys(patch)) {
    if (DANGEROUS_KEYS.has(key)) continue;

    const value = patch[key];
    const existing = result[key];

    if (isPlainObject(value) && isPlainObject(existing)) {
      result[key] = safeMerge(existing, value);
    } else if (isPlainObject(value)) {
      result[key] = safeMerge({}, value);
    } else {
      result[key] = value;
    }
  }

  return result as T;
}
