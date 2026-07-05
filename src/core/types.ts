/** Parsed representation of a single `data` field value from a schema JSON file. */
export type FieldSpec =
  | { kind: 'uuid' }
  | { kind: 'number'; mode: 'random' | 'increment'; min?: number; max?: number }
  | { kind: 'username'; style: 'FS' | 'NN' }
  | { kind: 'email'; domain?: string }
  | { kind: 'hash'; algorithm: 'generic' | 'md5' | 'sha256' }
  | { kind: 'lorem'; length?: number }
  | { kind: 'date'; range?: 'past' | 'future' }
  | { kind: 'boolean'; chance?: number }
  | { kind: 'enumInline'; values: string[] }
  | { kind: 'array'; item: FieldSpec; count: number }
  | { kind: 'custom'; name: string }
  | { kind: 'crossRef'; entity: string; field?: string };

/** One entry of a custom dictionary file under `mock/data/*.json`. */
export interface CustomDictionaryEntry {
  value: unknown;
  /** Hard cap on how many times this value may appear across the whole generated set. */
  max?: number;
  /** Weight/probability of this value being picked on a given attempt, in [0, 1]. */
  chance?: number;
}

/** A schema file under `mock/api/**`: one entity. */
export interface EntitySchema {
  /** Entity name, derived from the schema's route folder (e.g. "user", "blogpost"). */
  name: string;
  /** Absolute path to the schema's source JSON file, used for error locations. */
  file: string;
  amount: number;
  data: Record<string, FieldSpec>;
  /**
   * Schema-level opt-out of mocking this entity: a transport
   * handler for a bypassed entity calls MSW's `passthrough()`/`next/next`
   * lets the real backend answer instead of the generated mock, useful once
   * a specific endpoint's real backend is ready but the rest are still
   * mocked. `false`/omitted (the default) means "mock as usual".
   */
  bypass?: boolean;
}
