import { SchemaError } from './errors.js';
import { closestMatchScored } from './levenshtein.js';
import type { FieldSpec } from './types.js';

/**
 * Base type keywords recognized by the parser, used for typo suggestions.
 * These are bare prefixes (not full DSL strings) so a typo anywhere in a
 * parameterized type like `emial[gmail.com]` still matches against `email`.
 */
const KNOWN_BASE_TYPES = [
  'uuid',
  'number',
  'username',
  'email',
  'hash',
  'lorem',
  'date',
  'boolean',
  'enum',
  'array',
  'data',
] as const;

export interface ParseFieldTypeOptions {
  /** Names of custom dictionaries available under `mock/data/*.json`, e.g. ["role"]. */
  knownCustomTypes?: readonly string[];
  /** Location context used to build actionable error messages. */
  file?: string;
  fieldPath?: string;
}

/**
 * Parses a single DSL string (the "value" side of a `data` schema field, e.g.
 * `"email[gmail.com]"` or `"data.user.id"`) into a {@link FieldSpec}.
 *
 * Throws {@link SchemaError} (code `MP-SCHEMA-001`) with a location and, when
 * possible, a "did you mean" hint for unknown types.
 */
export function parseFieldType(raw: string, options: ParseFieldTypeOptions = {}): FieldSpec {
  const value = raw.trim();
  const knownCustomTypes = options.knownCustomTypes ?? [];

  // data.<entity> / data.<entity>.<field>
  const crossRefMatch = /^data\.([A-Za-z_][\w]*)(?:\.([A-Za-z_][\w]*))?$/.exec(value);
  if (crossRefMatch) {
    return { kind: 'crossRef', entity: crossRefMatch[1]!, field: crossRefMatch[2] };
  }

  // enum[a,b,c]
  const enumMatch = /^enum\[(.+)]$/.exec(value);
  if (enumMatch) {
    const values = enumMatch[1]!.split(',').map((v) => v.trim());
    return { kind: 'enumInline', values };
  }

  // array[<inner type>].<count>
  const arrayMatch = /^array\[(.+)]\.(\d+)$/.exec(value);
  if (arrayMatch) {
    const item = parseFieldType(arrayMatch[1]!, options);
    return { kind: 'array', item, count: Number(arrayMatch[2]) };
  }

  if (value === 'uuid') {
    return { kind: 'uuid' };
  }

  if (value === 'number') {
    return { kind: 'number', mode: 'random' };
  }
  if (value === 'number.increment') {
    return { kind: 'number', mode: 'increment' };
  }
  const numberRangeMatch = /^number\.(-?\d+)-(-?\d+)$/.exec(value);
  if (numberRangeMatch) {
    return {
      kind: 'number',
      mode: 'random',
      min: Number(numberRangeMatch[1]),
      max: Number(numberRangeMatch[2]),
    };
  }

  if (value === 'username.FS' || value === 'username.NN') {
    return { kind: 'username', style: value === 'username.FS' ? 'FS' : 'NN' };
  }

  if (value === 'email') {
    return { kind: 'email' };
  }
  const emailMatch = /^email\[([^\]]+)]$/.exec(value);
  if (emailMatch) {
    return { kind: 'email', domain: emailMatch[1] };
  }

  if (value === 'hash') {
    return { kind: 'hash', algorithm: 'generic' };
  }
  if (value === 'hash.md5' || value === 'hash.sha256') {
    return { kind: 'hash', algorithm: value === 'hash.md5' ? 'md5' : 'sha256' };
  }

  if (value === 'lorem') {
    return { kind: 'lorem' };
  }
  const loremMatch = /^lorem\.(\d+)$/.exec(value);
  if (loremMatch) {
    return { kind: 'lorem', length: Number(loremMatch[1]) };
  }

  if (value === 'date') {
    return { kind: 'date' };
  }
  if (value === 'date.past' || value === 'date.future') {
    return { kind: 'date', range: value === 'date.past' ? 'past' : 'future' };
  }

  if (value === 'boolean') {
    return { kind: 'boolean' };
  }
  const booleanMatch = /^boolean\.([01](?:\.\d+)?)$/.exec(value);
  if (booleanMatch) {
    return { kind: 'boolean', chance: Number(booleanMatch[1]) };
  }

  if (knownCustomTypes.includes(value)) {
    return { kind: 'custom', name: value };
  }

  // Compare the leading word (e.g. "emial" out of "emial[gmail.com]") against
  // known base-type prefixes, and the whole token against registered custom
  // types, then take whichever is the closer match: a bracket/param suffix
  // would otherwise dominate the edit distance and hide an obvious base-type typo.
  const prefix = /^[A-Za-z_]+/.exec(value)?.[0] ?? value;
  const baseGuess = closestMatchScored(prefix, KNOWN_BASE_TYPES);
  const customGuess = closestMatchScored(value, knownCustomTypes);
  const bestGuess = [baseGuess, customGuess]
    .filter((g): g is NonNullable<typeof g> => g !== undefined)
    .sort((a, b) => a.distance - b.distance)[0];
  const suggestion = bestGuess && bestGuess.distance <= 3 ? bestGuess.candidate : undefined;
  throw new SchemaError(
    'MP-SCHEMA-001',
    `unknown generator type "${value}"`,
    {
      location: options.file ? { file: options.file, path: options.fieldPath } : undefined,
      hint: suggestion ? `did you mean "${suggestion}"?` : undefined,
    },
  );
}
