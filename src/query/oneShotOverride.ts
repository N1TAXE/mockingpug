export interface OneShotOverrideEntry {
  /** Fail the very next request to this entity with a synthetic 500, regardless of `runtime.errorRate`. */
  failNext?: boolean;
  /** Delay the very next request to this entity by this many ms, regardless of `runtime.delay`. */
  delayNext?: number;
}

/**
 * Per-entity, one-shot error/delay overrides: a scalpel next to
 * `runtime.errorRate`/`runtime.delay`'s global blast radius (which, per
 * `mock-config.mdx`'s `errorRate: 1` warning, can even break the page that
 * renders `<MockDevtools>` itself). Arming a fail/delay override for one
 * entity affects exactly the next request to it, then is consumed — it
 * never lingers or repeats.
 */
export class OneShotOverrides {
  private readonly entries = new Map<string, OneShotOverrideEntry>();

  /** Arms (or updates) the override for `entity`. Merges with whatever's already armed, so `failNext` and `delayNext` can be set independently without clobbering each other. */
  set(entity: string, patch: OneShotOverrideEntry): void {
    const current = this.entries.get(entity) ?? {};
    this.entries.set(entity, { ...current, ...patch });
  }

  /** Reads and clears any armed override for `entity` in one step, so it only ever fires once. */
  consume(entity: string): OneShotOverrideEntry | undefined {
    const entry = this.entries.get(entity);
    if (entry) this.entries.delete(entity);
    return entry;
  }

  /** Reads the current armed state without consuming it, so devtools UI can reflect it (e.g. on a `DataWindow` re-opening). */
  peek(entity: string): OneShotOverrideEntry | undefined {
    return this.entries.get(entity);
  }
}

/** Whether `entry` actually has something armed (as opposed to `{}`/all-falsy, which behaves the same as "no override"). */
export function hasArmedOverride(entry: OneShotOverrideEntry | undefined): boolean {
  return Boolean(entry && (entry.failNext || entry.delayNext !== undefined));
}
