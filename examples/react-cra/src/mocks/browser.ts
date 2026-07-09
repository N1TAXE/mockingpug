import { setupWorker } from 'msw/browser';
import { MemoryStoreAdapter, generateAll, createMockHandlers, type QueryContext } from 'mockingpug/react';
import { schemas, customDictionaries } from './schemas';

const SEED = 'react-cra-example';

export async function startMocking() {
  const store = new MemoryStoreAdapter();
  await generateAll(schemas, store, { seed: SEED, customDictionaries });

  const ctx: QueryContext = {
    schemas,
    store,
    seed: SEED,
    customDictionaries,
    pagination: {
      strategy: 'page' as const,
      params: { page: 'page', limit: 'limit', offset: 'offset', cursor: 'cursor', groupBy: 'groupBy', limitPerGroup: 'limitPerGroup' },
      defaultLimit: 20,
      maxLimit: 100,
      envelope: true,
    },
  };

  const worker = setupWorker(...createMockHandlers(ctx, '/api'));
  // Started here, not left to `<MockProvider>` alone: `<App>` is a child of
  // `<MockProvider>` in `index.tsx`, and child effects commit *before* the
  // parent's on mount — if nothing awaited worker.start() first, `<App>`'s
  // own fetch()-on-mount would race ahead of the worker actually
  // intercepting anything and hit the real (non-existent) network instead.
  // `<MockProvider>` calling worker.start() again once mounted is a
  // harmless no-op (MSW logs a "redundant call" warning, doesn't throw).
  await worker.start({ onUnhandledRequest: 'bypass' });
  return { ctx, worker };
}
