/**
 * Sorts by `?sort=field:asc` / `?sort=field:desc` (defaults to `asc` when the
 * direction is omitted). Comma-separate multiple fields for a tie-break
 * order: `?sort=price:asc,name:desc` sorts by `price` first, then `name`
 * for records with equal `price`.
 */
export function sortRecords<T extends Record<string, unknown>>(
  records: readonly T[],
  searchParams: URLSearchParams,
  sortParam: string,
): T[] {
  const raw = searchParams.get(sortParam);
  if (!raw) return [...records];

  const clauses = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [field, direction] = part.split(':');
      return { field: field!, descending: direction?.trim().toLowerCase() === 'desc' };
    });

  if (clauses.length === 0) return [...records];

  return [...records].sort((a, b) => {
    for (const { field, descending } of clauses) {
      const cmp = compareValues(a[field], b[field]);
      if (cmp !== 0) return descending ? -cmp : cmp;
    }
    return 0;
  });
}

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const aStr = a === null || a === undefined ? '' : String(a);
  const bStr = b === null || b === undefined ? '' : String(b);
  return aStr < bStr ? -1 : aStr > bStr ? 1 : 0;
}
