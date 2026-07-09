// @vitest-environment jsdom
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MockProvider, useMockContext, type MockWorker } from '../../src/react/MockProvider.js';
import { generateAll, type SchemaBundle } from '../../src/generator/index.js';
import { MemoryStoreAdapter } from '../../src/store/memoryAdapter.js';
import { DEFAULT_CONFIG } from '../../src/cli/mockConfig.js';
import type { QueryContext } from '../../src/query/index.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const schemas: SchemaBundle = {
  user: { name: 'user', file: 'x', amount: 3, data: { id: { kind: 'number', mode: 'increment' } } },
};

async function makeCtx(): Promise<QueryContext> {
  const store = new MemoryStoreAdapter();
  await generateAll(schemas, store, { seed: 'provider-test' });
  return { schemas, store, pagination: DEFAULT_CONFIG.pagination, seed: 'provider-test' };
}

function fakeWorker() {
  return {
    start: vi.fn<(options?: unknown) => Promise<unknown>>().mockResolvedValue(undefined),
    stop: vi.fn<() => void>(),
  } satisfies MockWorker;
}

function Probe() {
  const { mode, ctx } = useMockContext();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="delay">{ctx.runtime?.delay ?? 0}</span>
    </div>
  );
}

describe('MockProvider', () => {
  it('renders children', () => {
    render(
      <MockProvider worker={fakeWorker()} ctx={{} as QueryContext}>
        <div>hello</div>
      </MockProvider>,
    );
    expect(screen.getByText('hello')).toBeTruthy();
  });

  it('starts the worker when mode is "mock" (the default)', async () => {
    const worker = fakeWorker();
    const ctx = await makeCtx();
    render(
      <MockProvider worker={worker} ctx={ctx} storageKey={null}>
        <Probe />
      </MockProvider>,
    );
    await waitFor(() => expect(worker.start).toHaveBeenCalledTimes(1));
    expect(worker.stop).not.toHaveBeenCalled();
  });

  it('stops (does not start) the worker when initialMode is "off"', async () => {
    const worker = fakeWorker();
    const ctx = await makeCtx();
    render(
      <MockProvider worker={worker} ctx={ctx} initialMode="off" storageKey={null}>
        <Probe />
      </MockProvider>,
    );
    await waitFor(() => expect(worker.stop).toHaveBeenCalled());
    expect(worker.start).not.toHaveBeenCalled();
  });

  it('useMockContext() throws when used outside <MockProvider>', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    function Bare() {
      useMockContext();
      return null;
    }
    expect(() => render(<Bare />)).toThrow(/useMockContext\(\) must be used inside/);
    consoleSpy.mockRestore();
  });

  it('persists the mode to localStorage under storageKey, and a later mount picks it up', async () => {
    const worker1 = fakeWorker();
    const ctx = await makeCtx();
    const { unmount } = render(
      <MockProvider worker={worker1} ctx={ctx} storageKey="mockingpug:test-mode">
        <Probe />
      </MockProvider>,
    );
    await waitFor(() => expect(worker1.start).toHaveBeenCalled());
    expect(localStorage.getItem('mockingpug:test-mode')).toBeNull();
    unmount();

    // Directly persist "off" the way setMode() would, then remount and confirm it's honored as the initial mode.
    localStorage.setItem('mockingpug:test-mode', 'off');
    const worker2 = fakeWorker();
    render(
      <MockProvider worker={worker2} ctx={ctx} initialMode="mock" storageKey="mockingpug:test-mode">
        <Probe />
      </MockProvider>,
    );
    expect(screen.getByTestId('mode').textContent).toBe('off');
    await waitFor(() => expect(worker2.stop).toHaveBeenCalled());
    expect(worker2.start).not.toHaveBeenCalled();
  });

  it("survives StrictMode's dev-only mount->cleanup->mount without a double worker.start()", async () => {
    // Before the fix, the fake mount's effect and the real mount's effect
    // each called worker.start() directly and synchronously, with no
    // gating — two calls, racing whichever one's promise settled last
    // (reproducing MSW's real "cannot configure an already enabled
    // network" throw). worker.start() returning a promise is enough to
    // reproduce this: any `.then()` continuation is deferred to a
    // microtask, always landing *after* the synchronous cleanup -> remount
    // that StrictMode does, regardless of how fast the promise settles.
    const worker = fakeWorker();
    const ctx = await makeCtx();

    render(
      <StrictMode>
        <MockProvider worker={worker} ctx={ctx} storageKey={null}>
          <Probe />
        </MockProvider>
      </StrictMode>,
    );

    await waitFor(() => expect(worker.start).toHaveBeenCalledTimes(1));
    // Give any stale/queued transition a chance to run before asserting there wasn't a second call.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(worker.start).toHaveBeenCalledTimes(1);
  });
});
