/**
 * Every DSL string form `parseFieldType()` (parser.ts) recognizes, with a
 * one-line description and, where the form is representable as a single
 * runnable string, an example. `mpug generators` prints this catalog
 * directly, and `tests/core/generatorCatalog.test.ts` pipes every `example`
 * through the real `parseFieldType()` — so this list can't silently drift
 * from what the parser actually accepts, unlike a hand-maintained doc page.
 *
 * `custom` (dictionary-backed types, whose names come from `mock/data/*.json`
 * and aren't known statically) and `conditional` (the `{when,then,else}`
 * object form, not a string) are documented here without a runnable
 * `example`, since neither can be expressed as a standalone DSL string.
 */
export interface GeneratorCatalogEntry {
  category: string;
  syntax: string;
  description: string;
  example?: string;
}

export const GENERATOR_CATALOG: readonly GeneratorCatalogEntry[] = [
  { category: 'Scalars', syntax: 'uuid', description: 'Seeded UUID v4 (not crypto.randomUUID()).', example: 'uuid' },
  { category: 'Scalars', syntax: 'number', description: 'Random integer in [0, 1_000_000] by default.', example: 'number' },
  { category: 'Scalars', syntax: 'number.<min>-<max>', description: 'Random integer in [min, max]. Negative bounds allowed.', example: 'number.1-100' },
  {
    category: 'Scalars',
    syntax: 'number.float.<min>-<max>.<precision>',
    description: 'Random float in [min, max], rounded to <precision> decimal places.',
    example: 'number.float.4-5.1',
  },
  {
    category: 'Scalars',
    syntax: 'number.increment',
    description: 'Auto-incrementing counter, starting at 1, scoped per entity+field.',
    example: 'number.increment',
  },
  { category: 'Scalars', syntax: 'username.FS', description: '"First Last": a real first + last name pair.', example: 'username.FS' },
  { category: 'Scalars', syntax: 'username.NN', description: '"AdjectiveNoun123": an adjective + noun + number nickname.', example: 'username.NN' },
  { category: 'Scalars', syntax: 'email', description: 'local.1234@<random-domain>.', example: 'email' },
  { category: 'Scalars', syntax: 'email[<domain>]', description: 'Same, with a fixed domain.', example: 'email[gmail.com]' },
  {
    category: 'Scalars',
    syntax: 'hash / hash.md5 / hash.sha256',
    description: 'A hex string shaped like a digest (32/32/64 hex chars). Not a real cryptographic hash.',
    example: 'hash.sha256',
  },
  { category: 'Scalars', syntax: 'lorem', description: '6 to 24 random lorem-ipsum words.', example: 'lorem' },
  { category: 'Scalars', syntax: 'lorem.<N>', description: 'Lorem text truncated/padded to exactly N characters.', example: 'lorem.120' },
  {
    category: 'Scalars',
    syntax: 'date / date.past / date.future',
    description: 'ISO timestamp within one year of a fixed reference date, before/after/around it.',
    example: 'date.past',
  },
  { category: 'Scalars', syntax: 'boolean', description: '50/50 random boolean by default.', example: 'boolean' },
  { category: 'Scalars', syntax: 'boolean.<p>', description: 'true with probability p, 0 to 1.', example: 'boolean.0.9' },
  {
    category: 'Scalars',
    syntax: 'enum[a,b,c]',
    description: 'Uniformly random pick among the literal, comma-separated values.',
    example: 'enum[red,green,blue]',
  },
  {
    category: 'Arrays',
    syntax: 'array[<inner type>].<count>',
    description: 'Fixed-length array, recursing into <inner type> (any other DSL form) for each element.',
    example: 'array[lorem].3',
  },
  {
    category: 'Structural',
    syntax: 'slugify[<field>,<separator>]',
    description: "Transliterates + slugifies another field on the same record, e.g. a product's name into its slug.",
    example: 'slugify[title,-]',
  },
  {
    category: 'Structural',
    syntax: 'custom dictionary name',
    description: 'A weighted pick from a mock/data/<name>.json dictionary — the DSL string is just the dictionary\'s own name.',
  },
  {
    category: 'Structural',
    syntax: '{ "when": {...}, "then": ..., "else": ... }',
    description: 'Conditional generation based on another field already generated on the same record. Object form, not a string.',
  },
  {
    category: 'Relations',
    syntax: 'data.<entity>',
    description: "Cross-entity reference: picks a related record's id.",
    example: 'data.user',
  },
  {
    category: 'Relations',
    syntax: 'data.<entity>.<field>',
    description: 'Cross-entity reference to a specific field on the related record.',
    example: 'data.user.name',
  },
  {
    category: 'Relations',
    syntax: 'data.<entity>.[field1,field2,...]',
    description: 'Correlated multi-field pick: two or more flat output fields from the same related record.',
    example: 'data.user.[id,name]',
  },
];
