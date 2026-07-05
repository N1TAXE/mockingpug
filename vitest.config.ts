import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/**/index.ts', 'src/core/types.ts'],
      thresholds: {
        statements: 85,
        lines: 85,
        functions: 85,
        branches: 80,
        // Security-critical files — every defensive branch must be
        // exercised by an attack-style test, not just "mostly covered".
        'src/store/safeMerge.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'src/store/adapter.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
      },
    },
  },
});
