/**
 * Runtime state for per-request bypass: which exact `METHOD pathname`
 * combinations (e.g. `"GET /api/faqCategory"`, `"GET /api/product/5"`, each
 * independent of the other, list vs item) should let the real backend
 * answer instead of the mock — matching however your app code actually
 * calls the mock (a list fetch, a by-id fetch, a mutation), not a stored
 * record's identity. Query strings are deliberately excluded from the key
 * (`?page=2` vs `?page=3` is still "the same request" for this purpose).
 * Framework-agnostic — shared by `mockingpug/react` (where "answer for
 * real" means MSW's `passthrough()`) and `mockingpug/next` (where it means
 * forwarding to `mock.config.js`'s `target`), both reached through
 * `QueryContext.requestBypass`, the same pattern `OneShotOverrides`/
 * `RequestLog` already use for other `<MockDevtools>`-only runtime state.
 */
export class RequestBypass {
  private readonly bypassed = new Set<string>();

  private key(method: string, pathname: string): string {
    return `${method.toUpperCase()} ${pathname}`;
  }

  set(method: string, pathname: string, isBypassed: boolean): void {
    const key = this.key(method, pathname);
    if (isBypassed) this.bypassed.add(key);
    else this.bypassed.delete(key);
  }

  isBypassed(method: string, pathname: string): boolean {
    return this.bypassed.has(this.key(method, pathname));
  }

  /** Every currently-bypassed `"METHOD pathname"` key, so a devtools view can reflect real state instead of assuming "nothing bypassed". */
  list(): string[] {
    return [...this.bypassed];
  }
}
