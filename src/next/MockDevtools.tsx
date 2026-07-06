'use client';

import { useState } from 'react';
import { DevtoolsPanel } from '../shared/devtoolsUI.js';
import { DEVTOOLS_SEGMENT } from './devtoolsPath.js';

// Re-exported here (not from `mockingpug/next`) because it's meant to be
// called from client-side code: importing it from the server entry would
// drag that entry's Node-touching module graph (`getMockContext()`'s
// `node:fs` watcher) into a client component's bundle. See `next/README.md`.
export {
  getLiveToggleCookie,
  setLiveToggleCookie,
  DEFAULT_LIVE_TOGGLE_COOKIE,
  type SetLiveToggleCookieOptions,
} from './liveToggleClient.js';

export interface MockDevtoolsProps {
  /** Must match `mock.config.js`'s `baseUrl`. Defaults to `/api`, same as the transport itself. */
  baseUrl?: string;
}

interface Snapshot {
  entities: Record<string, number>;
  runtime: { delay: number; errorRate: number };
}

/**
 * `<MockDevtools>` for the Next.js Route Handler transport: same floating
 * panel as `mockingpug/react`'s, but talks to the devtools sub-API under
 * `{baseUrl}/__mockingpug/*` over `fetch()` instead of a React context,
 * since a Route Handler runs server-side and there's no client-side store
 * to read directly.
 *
 * No "mock network" toggle and no per-entity bypass here, both are
 * React/MSW-specific concepts that don't apply to a Route Handler, which
 * *is* the real server (see `next/README.md`). Use the `rewrites()` recipe
 * there to route a specific path around the mock entirely.
 */
export function MockDevtools({ baseUrl = '/api' }: MockDevtoolsProps = {}) {
  const apiBase = `${baseUrl}/${DEVTOOLS_SEGMENT}`;
  const [snapshot, setSnapshot] = useState<Snapshot>({ entities: {}, runtime: { delay: 0, errorRate: 0 } });

  async function refresh() {
    const res = await fetch(apiBase);
    setSnapshot((await res.json()) as Snapshot);
  }

  async function fetchRecords(entity: string): Promise<unknown[]> {
    const res = await fetch(`${apiBase}/records/${entity}`);
    const { records } = (await res.json()) as { records: unknown[] };
    return records;
  }

  async function resetEntity(entity: string): Promise<unknown[]> {
    const res = await fetch(`${apiBase}/reset/${entity}`, { method: 'POST' });
    const { records } = (await res.json()) as { records: unknown[] };
    setSnapshot((prev) => ({ ...prev, entities: { ...prev.entities, [entity]: records.length } }));
    return records;
  }

  async function updateRuntime(patch: { delay?: number; errorRate?: number }) {
    const res = await fetch(`${apiBase}/runtime`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const runtime = (await res.json()) as { delay: number; errorRate: number };
    setSnapshot((prev) => ({ ...prev, runtime }));
  }

  return (
    <DevtoolsPanel
      title="mockingpug (next)"
      entities={snapshot.entities}
      runtime={snapshot.runtime}
      onRuntimeChange={(patch) => void updateRuntime(patch)}
      onFetchRecords={fetchRecords}
      onResetEntity={resetEntity}
      onOpen={() => void refresh()}
    />
  );
}
