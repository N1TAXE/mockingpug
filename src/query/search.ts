/**
 * Case-insensitive substring search, triggered by `?q=term`. Checks every
 * string-valued field on the record by default; restrict to specific
 * fields with `?q=term&searchFields=name,description`.
 */
export function searchRecords<T extends Record<string, unknown>>(
  records: readonly T[],
  searchParams: URLSearchParams,
  queryParamName: string,
  fieldsParamName: string,
): T[] {
  const term = searchParams.get(queryParamName);
  if (!term) return [...records];
  const needle = term.toLowerCase();

  const fieldsRaw = searchParams.get(fieldsParamName);
  const fields = fieldsRaw
    ? fieldsRaw.split(',').map((f) => f.trim()).filter(Boolean)
    : null;

  return records.filter((record) => {
    const values = fields ? fields.map((field) => record[field]) : Object.values(record);
    return values.some((value) => typeof value === 'string' && value.toLowerCase().includes(needle));
  });
}
