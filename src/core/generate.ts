import { GenerationError } from './errors.js';
import { pick, randomInt, type Rng } from './rng.js';
import type { FieldSpec } from './types.js';
import {
  EMAIL_DOMAINS,
  FIRST_NAMES,
  LAST_NAMES,
  LOREM_WORDS,
  NICKNAME_ADJECTIVES,
  NICKNAME_NOUNS,
} from './wordlists.js';

/** Tracks per-entity `number.increment` counters across a generation run. */
export class IncrementCounters {
  private readonly counters = new Map<string, number>();

  next(key: string): number {
    const value = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, value);
    return value;
  }

  /** Fast-forwards a counter so the next `next()` continues past `value`, used when appending records to an existing entity. */
  seed(key: string, value: number): void {
    const current = this.counters.get(key) ?? 0;
    if (value > current) this.counters.set(key, value);
  }
}

export interface GenerateContext {
  /** Resolves a custom-dictionary field (`kind: 'custom'`) to a concrete value. */
  resolveCustom: (name: string, rng: Rng) => unknown;
  /** Shared per-entity increment counters, so `number.increment` continues across records. */
  increments: IncrementCounters;
  /** Key identifying the current field, used to scope increment counters (e.g. "user.id"). */
  incrementKey: string;
}

function loremText(rng: Rng, length?: number): string {
  if (length === undefined) {
    const wordCount = randomInt(rng, 6, 24);
    return Array.from({ length: wordCount }, () => pick(rng, LOREM_WORDS)).join(' ');
  }
  let text = '';
  while (text.length < length) {
    text += (text.length > 0 ? ' ' : '') + pick(rng, LOREM_WORDS);
  }
  return text.slice(0, length);
}

function randomDate(rng: Rng, range?: 'past' | 'future'): string {
  const now = Date.UTC(2024, 0, 1);
  const oneYearMs = 365 * 24 * 60 * 60 * 1000;
  const offset = randomInt(rng, 0, oneYearMs);
  const timestamp = range === 'future' ? now + offset : range === 'past' ? now - offset : now - oneYearMs / 2 + offset;
  return new Date(timestamp).toISOString();
}

function hexDigits(rng: Rng, count: number): string {
  let hex = '';
  while (hex.length < count) hex += Math.floor(rng() * 16).toString(16);
  return hex.slice(0, count);
}

/**
 * Produces a hex string shaped like an md5/sha256 digest, NOT a real
 * cryptographic hash. Mock data has no need for one (nothing here is meant
 * to be verified against real input), and a real implementation would
 * require Node's `node:crypto` (unavailable/async-only in browsers) or the
 * async Web Crypto API, breaking both this function's sync signature and
 * `mockingpug/react`'s ability to run in a browser bundle.
 */
function randomHash(rng: Rng, algorithm: 'generic' | 'md5' | 'sha256'): string {
  return hexDigits(rng, algorithm === 'sha256' ? 64 : 32);
}

/**
 * UUID v4, generated from `rng` rather than `crypto.randomUUID()`: the
 * latter is never deterministic from a seed, which would silently break
 * this library's core promise that the same seed always reproduces the same
 * data. Also keeps this generator free of any
 * `node:crypto` dependency, which matters for browser bundles.
 */
function randomUuidV4(rng: Rng): string {
  const hex = hexDigits(rng, 32).split('');
  hex[12] = '4';
  hex[16] = ['8', '9', 'a', 'b'][Math.floor(rng() * 4)]!;
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

/**
 * Produces the concrete value for one field. Cross-entity references
 * (`kind: 'crossRef'`) are out of scope here: they're resolved by the
 * dependency-graph module against already-generated entities.
 */
export function generateValue(spec: FieldSpec, rng: Rng, ctx: GenerateContext): unknown {
  switch (spec.kind) {
    case 'uuid':
      return randomUuidV4(rng);

    case 'number':
      if (spec.mode === 'increment') {
        return ctx.increments.next(ctx.incrementKey);
      }
      return randomInt(rng, spec.min ?? 0, spec.max ?? 1_000_000);

    case 'username':
      if (spec.style === 'FS') {
        return `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`;
      }
      return `${pick(rng, NICKNAME_ADJECTIVES)}${pick(rng, NICKNAME_NOUNS)}${randomInt(rng, 1, 999)}`;

    case 'email': {
      const local = `${pick(rng, FIRST_NAMES).toLowerCase()}.${randomInt(rng, 1, 9999)}`;
      const domain = spec.domain ?? pick(rng, EMAIL_DOMAINS);
      return `${local}@${domain}`;
    }

    case 'hash':
      return randomHash(rng, spec.algorithm);

    case 'lorem':
      return loremText(rng, spec.length);

    case 'date':
      return randomDate(rng, spec.range);

    case 'boolean':
      return rng() < (spec.chance ?? 0.5);

    case 'enumInline':
      return pick(rng, spec.values);

    case 'array':
      return Array.from({ length: spec.count }, (_, i) =>
        generateValue(spec.item, rng, { ...ctx, incrementKey: `${ctx.incrementKey}[${i}]` }),
      );

    case 'custom':
      return ctx.resolveCustom(spec.name, rng);

    case 'crossRef':
      throw new GenerationError(
        'MP-GEN-001',
        `cross-entity reference "data.${spec.entity}${spec.field ? `.${spec.field}` : ''}" cannot be resolved by generateValue() directly`,
        {
          hint:
            'resolve crossRef fields through the dependency-graph module, not generate.ts — a single-level ' +
            '"array[data.<entity>.<field>].N" is handled in recordGenerator.ts before ever reaching here; ' +
            'a bare/multi-pick item is rejected at parse time (MP-SCHEMA-022); a nested array of crossRef items is not supported',
        },
      );

    case 'slugify':
      throw new GenerationError(
        'MP-GEN-006',
        `"slugify[${spec.field},${spec.separator}]" cannot be resolved by generateValue() directly`,
        { hint: 'resolve slugify fields in recordGenerator.ts, where the sibling record is available' },
      );

    case 'literal':
      return spec.value;

    case 'conditional':
      throw new GenerationError(
        'MP-GEN-008',
        `a conditional field ("when"/"then"/"else") cannot be resolved by generateValue() directly`,
        { hint: 'resolve conditional fields in recordGenerator.ts, where the sibling record needed to evaluate "when" is available' },
      );

    /* v8 ignore next 4 -- exhaustiveness guard, unreachable for any valid FieldSpec */
    default: {
      const exhaustive: never = spec;
      throw new GenerationError('MP-GEN-000', `unhandled field spec: ${JSON.stringify(exhaustive)}`);
    }
  }
}
