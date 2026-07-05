// `mockingpug/vite` resolves this at build time; it doesn't ship its own
// ambient type declaration (rollup-plugin-dts chokes on `declare module`
// blocks for non-resolvable specifiers like `virtual:*`), so consumers add
// this small shim themselves — same pattern as Vite's own `virtual:*` env
// modules.
declare module 'virtual:mockingpug/schemas' {
  import type { CustomDictionaryEntry, EntitySchema } from 'mockingpug';

  export const schemas: Record<string, EntitySchema>;
  export const customDictionaries: Record<string, CustomDictionaryEntry[]>;
}
