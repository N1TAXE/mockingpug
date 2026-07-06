/**
 * Exact-match filtering by query param: `?category_id=3` keeps records
 * whose `category_id` field stringifies to `"3"`. A comma-separated value
 * (`?category_id=1,2,3`) is treated as an OR/`in` filter on that field.
 * Multiple distinct filter params are ANDed together.
 *
 * Every query param name is a candidate filter except the ones in
 * `reservedParams` (the active pagination param names and `sort`), so
 * filtering needs no config: any schema field is filterable by default.
 */
export function filterRecords<T extends Record<string, unknown>>(
  records: readonly T[],
  searchParams: URLSearchParams,
  reservedParams: ReadonlySet<string>,
): T[] {
  const filters: Array<{ field: string; values: Set<string> }> = [];
  for (const [key, value] of searchParams.entries()) {
    if (reservedParams.has(key)) continue;
    const values = value.split(',').map((v) => v.trim());
    const existing = filters.find((f) => f.field === key);
    if (existing) {
      for (const v of values) existing.values.add(v);
    } else {
      filters.push({ field: key, values: new Set(values) });
    }
  }

  if (filters.length === 0) return [...records];

  return records.filter((record) =>
    filters.every((f) => f.values.has(stringifyFieldValue(record[f.field]))),
  );
}

function stringifyFieldValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}
