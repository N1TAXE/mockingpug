import { GenerationError } from './errors.js';
import type { Rng } from './rng.js';
import type { CustomDictionaryEntry } from './types.js';

interface TrackedEntry {
  entry: CustomDictionaryEntry;
  count: number;
}

/**
 * Weighted picker over a `mock/data/*.json` dictionary: entries
 * with an explicit `chance` are rolled probabilistically on every pick;
 * entries without one form the fallback pool used when no probabilistic
 * entry hits. `max` hard-caps how many times any entry may be produced
 * across the whole picker's lifetime (one generation run).
 */
export class CustomDictionaryPicker {
  private readonly name: string;
  private readonly tracked: TrackedEntry[];

  constructor(name: string, entries: readonly CustomDictionaryEntry[]) {
    if (entries.length === 0) {
      throw new GenerationError(
        'MP-GEN-002',
        `custom dictionary "${name}" is empty: mock/data/${name}.json must contain at least one entry`,
      );
    }
    this.name = name;
    this.tracked = entries.map((entry) => ({ entry, count: 0 }));
  }

  pick(rng: Rng): unknown {
    const eligible = this.tracked.filter(
      (t) => t.entry.max === undefined || t.count < t.entry.max,
    );
    if (eligible.length === 0) {
      throw new GenerationError(
        'MP-GEN-003',
        `custom dictionary "${this.name}" ran out of eligible values: every entry hit its "max" cap`,
        { hint: 'raise "max" on at least one entry, or lower the entity\'s "amount"' },
      );
    }

    const probabilistic = eligible.filter((t) => t.entry.chance !== undefined);
    for (const candidate of probabilistic) {
      if (rng() < (candidate.entry.chance as number)) {
        candidate.count++;
        return candidate.entry.value;
      }
    }

    const fallbackPool = eligible.filter((t) => t.entry.chance === undefined);
    const pool = fallbackPool.length > 0 ? fallbackPool : eligible;
    const chosen = pool[Math.floor(rng() * pool.length)]!;
    chosen.count++;
    return chosen.entry.value;
  }
}
