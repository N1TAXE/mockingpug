import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'core/index': 'src/core/index.ts',
    'cli/index': 'src/cli/index.ts',
    'cli/bin': 'src/cli/bin.ts',
    'react/index': 'src/react/index.ts',
    'next/index': 'src/next/index.ts',
    'next/MockDevtools': 'src/next/MockDevtools.tsx',
    'vite/index': 'src/vite/index.ts',
  },
  external: ['vite', 'react', 'react-dom'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  // No shared chunks: bin.ts relies on comparing its own `import.meta.url`
  // against process.argv[1] to detect direct execution — if that logic got
  // hoisted into a shared chunk, import.meta.url would point at the chunk
  // file instead of bin.js, breaking the check.
  splitting: false,
});
