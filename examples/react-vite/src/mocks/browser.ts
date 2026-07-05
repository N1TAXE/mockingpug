import { setupWorker } from 'msw/browser';
import { MemoryStoreAdapter, generateAll, createMockHandlers } from 'mockingpug/react';
import { schemas, customDictionaries } from './schemas';

const SEED = 'react-vite-example';

export async function startMocking() {
  const store = new MemoryStoreAdapter();
  await generateAll(schemas, store, { seed: SEED, customDictionaries });

  const ctx = {
    schemas,
    store,
    seed: SEED,
    customDictionaries,
    pagination: {
      strategy: 'page' as const,
      params: { page: 'page', limit: 'limit', offset: 'offset', cursor: 'cursor' },
      defaultLimit: 20,
      maxLimit: 100,
      envelope: true,
    },
  };

  const worker = setupWorker(...createMockHandlers(ctx, '/api'));
  await worker.start({ onUnhandledRequest: 'bypass' });
}
