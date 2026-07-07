/**
 * Builds a single-line `curl` command for manual testing outside the
 * browser (Postman, terminal), used by `<MockDevtools>`'s "Copy as curl"
 * button. `body`, when given, is JSON-encoded and sent with a matching
 * `Content-Type` header — omit it for `GET`/`DELETE`.
 */
export function buildCurlCommand(method: string, url: string, body?: unknown): string {
  const parts = [`curl -X ${method}`, quoteShellArg(url)];
  if (body !== undefined) {
    parts.push(`-H 'Content-Type: application/json'`);
    parts.push(`-d ${quoteShellArg(JSON.stringify(body))}`);
  }
  return parts.join(' ');
}

/** Wraps `value` in single quotes for POSIX shells, escaping any single quotes it contains (`'` -> `'\''`). */
function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
