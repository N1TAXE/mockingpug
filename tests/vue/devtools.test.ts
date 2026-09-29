// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import { MemoryStoreAdapter } from '../../src/store/memoryAdapter.js';
import { generateAll, type SchemaBundle } from '../../src/generator/index.js';
import { DEFAULT_CONFIG } from '../../src/cli/mockConfig.js';
import type { QueryContext } from '../../src/query/index.js';
import { isRuntimeBypassed, resetBypassState } from '../../src/react/bypassState.js';
import { MockDevtools } from '../../src/vue/MockDevtools.js';

const schemas: SchemaBundle = {
  user: { name: 'user', file: 'x', amount: 3, data: { id: { kind: 'number', mode: 'increment' }, name: { kind: 'username', style: 'FS' } } },
};

async function makeCtx(): Promise<QueryContext> {
  const store = new MemoryStoreAdapter();
  await generateAll(schemas, store, { seed: 'vue-dt' });
  return { schemas, store, pagination: DEFAULT_CONFIG.pagination, seed: 'vue-dt' };
}

const flush = async () => { await nextTick(); await new Promise((r) => setTimeout(r, 0)); await nextTick(); };

let app: App | undefined;
let container: HTMLElement | undefined;

afterEach(() => {
  app?.unmount();
  container?.remove();
  resetBypassState();
});

beforeEach(() => resetBypassState());

async function mount(ctx: QueryContext): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  app = createApp(MockDevtools, { ctx, baseUrl: '/api' });
  app.mount(container);
  await flush();
}

describe('mockingpug/vue MockDevtools', () => {
  it('mounts a floating toggle and opens the panel with the core controls', async () => {
    await mount(await makeCtx());
    const toggle = document.querySelector<HTMLElement>('[aria-label="Open mockingpug devtools"]');
    expect(toggle).toBeTruthy();

    toggle!.click();
    await flush();

    expect(document.body.textContent).toContain('Mock Data');
    expect(document.body.textContent).toContain('Requests');
    expect(document.querySelector('[aria-label="Delay (ms)"]')).toBeTruthy();
    expect(document.querySelector('[aria-label="Error rate (0-1)"]')).toBeTruthy();
  });

  it('wires runtime state onto a bare ctx (so the request log control exists)', async () => {
    const ctx = await makeCtx();
    expect(ctx.requestLog).toBeUndefined();
    await mount(ctx);
    // R27 controller attached the runtime state on mount.
    expect(ctx.requestLog).toBeDefined();
    expect(ctx.requestBypass).toBeDefined();
    expect(ctx.oneShotOverrides).toBeDefined();
  });

  it('lists entities and toggles per-entity bypass through the panel', async () => {
    const ctx = await makeCtx();
    await mount(ctx);
    document.querySelector<HTMLElement>('[aria-label="Open mockingpug devtools"]')!.click();
    await flush();

    // Navigate into "Mock Data".
    const nav = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Mock Data'));
    nav!.click();
    await flush();

    expect(document.querySelector('[data-testid="entity-row-user"]')).toBeTruthy();

    const bypassSwitch = document.querySelector<HTMLElement>('[aria-label="Bypass user"]');
    expect(bypassSwitch).toBeTruthy();
    expect(isRuntimeBypassed('user')).toBe(false);
    bypassSwitch!.click();
    expect(isRuntimeBypassed('user')).toBe(true);
  });
});
