// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MockDevtools } from '../../src/react/MockDevtools.js';
import { MockProvider, type MockWorker } from '../../src/react/MockProvider.js';
import { generateAll, type SchemaBundle } from '../../src/generator/index.js';
import { MemoryStoreAdapter } from '../../src/store/memoryAdapter.js';
import { DEFAULT_CONFIG } from '../../src/cli/mockConfig.js';
import type { QueryContext } from '../../src/query/index.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const schemas: SchemaBundle = {
  user: {
    name: 'user',
    file: 'x',
    amount: 3,
    data: { id: { kind: 'number', mode: 'increment' }, name: { kind: 'username', style: 'FS' } },
  },
};

async function makeCtx(): Promise<QueryContext> {
  const store = new MemoryStoreAdapter();
  await generateAll(schemas, store, { seed: 'devtools-test' });
  return { schemas, store, pagination: DEFAULT_CONFIG.pagination, seed: 'devtools-test' };
}

function fakeWorker(): MockWorker {
  return { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn() };
}

async function renderDevtools() {
  const ctx = await makeCtx();
  render(
    <MockProvider worker={fakeWorker()} ctx={ctx} storageKey={null}>
      <MockDevtools />
    </MockProvider>,
  );
  return ctx;
}

function openPanel() {
  fireEvent.click(screen.getByRole('button', { name: 'Open mockingpug devtools' }));
}

/** Entity counts load asynchronously on open, so wait for the nav row's count before navigating. */
async function openList() {
  await waitFor(() => expect(screen.getByRole('button', { name: /Mock Data \(\d+\)/ })).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: /Mock Data/ }));
}

describe('MockDevtools', () => {
  it('renders collapsed, showing only the round toggle button', async () => {
    await renderDevtools();
    expect(screen.getByRole('button', { name: 'Open mockingpug devtools' })).toBeTruthy();
    expect(screen.queryByRole('switch', { name: /mock network/i })).toBeNull();
  });

  it('the toggle button becomes a close button once the panel is open', async () => {
    await renderDevtools();
    openPanel();
    expect(screen.getByRole('button', { name: 'Hide mockingpug devtools' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open mockingpug devtools' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Hide mockingpug devtools' }));
    expect(screen.getByRole('button', { name: 'Open mockingpug devtools' })).toBeTruthy();
  });

  it('opens the panel on click, showing settings and a link to the entity list', async () => {
    await renderDevtools();
    openPanel();
    expect(screen.getByRole('switch', { name: /mock network/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Mock Data/ })).toBeTruthy();
  });

  it('navigating to the entity list shows every entity with its record count', async () => {
    await renderDevtools();
    openPanel();
    await openList();
    expect(screen.getByRole('button', { name: 'Open user records' })).toBeTruthy();
  });

  it('unchecking "mock network" switches mode to off and stops the worker', async () => {
    const ctx = await makeCtx();
    const worker = fakeWorker();
    render(
      <MockProvider worker={worker} ctx={ctx} storageKey={null}>
        <MockDevtools />
      </MockProvider>,
    );
    openPanel();
    const toggle = screen.getByRole('switch', { name: /mock network/i });
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    await waitFor(() => expect(worker.stop).toHaveBeenCalled());
  });

  it('editing delay/errorRate mutates ctx.runtime live', async () => {
    const ctx = await makeCtx();
    render(
      <MockProvider worker={fakeWorker()} ctx={ctx} storageKey={null}>
        <MockDevtools />
      </MockProvider>,
    );
    openPanel();

    const delayInput = screen.getByLabelText('Delay (ms)');
    fireEvent.change(delayInput, { target: { value: '250' } });
    await waitFor(() => expect(ctx.runtime?.delay).toBe(250));
  });

  it('clicking anywhere in an entity row (not just its text/icon) opens its records', async () => {
    const ctx = await renderDevtools();
    openPanel();
    await openList();
    // Click the row container itself, not the label or the chevron button:
    // the whole padded row must be a click target.
    fireEvent.click(screen.getByTestId('entity-row-user'));

    const stored = await ctx.store.load('user');
    await waitFor(() => {
      expect(screen.getByText(new RegExp(String(stored!.records[0]!.id)))).toBeTruthy();
    });
  });

  it('opening an entity from the list shows its stored records in a floating window', async () => {
    const ctx = await renderDevtools();
    openPanel();
    await openList();
    fireEvent.click(screen.getByRole('button', { name: 'Open user records' }));

    const stored = await ctx.store.load('user');
    await waitFor(() => {
      expect(screen.getByText(new RegExp(String(stored!.records[0]!.id)))).toBeTruthy();
    });
  });

  it('the data window\'s close button actually closes it', async () => {
    const ctx = await renderDevtools();
    openPanel();
    await openList();
    fireEvent.click(screen.getByRole('button', { name: 'Open user records' }));

    const stored = await ctx.store.load('user');
    await waitFor(() => {
      expect(screen.getByText(new RegExp(String(stored!.records[0]!.id)))).toBeTruthy();
    });

    const closeButton = screen.getByRole('button', { name: 'Close user window' });
    fireEvent.click(closeButton);
    expect(screen.queryByRole('button', { name: 'Close user window' })).toBeNull();
  });

  it('toggling the per-entity bypass switch calls bypass()/unbypass()', async () => {
    const { isRuntimeBypassed, resetBypassState } = await import('../../src/react/bypassState.js');
    await renderDevtools();
    openPanel();
    await openList();

    const bypassSwitch = screen.getByRole('switch', { name: 'Bypass user' });
    expect(isRuntimeBypassed('user')).toBe(false);

    fireEvent.click(bypassSwitch);
    expect(isRuntimeBypassed('user')).toBe(true);

    fireEvent.click(bypassSwitch);
    expect(isRuntimeBypassed('user')).toBe(false);
    resetBypassState();
  });

  it('the data window\'s reset button regenerates the entity\'s records', async () => {
    const ctx = await renderDevtools();
    const before = await ctx.store.load('user');

    openPanel();
    await openList();
    fireEvent.click(screen.getByRole('button', { name: 'Open user records' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reset user' }));

    await waitFor(async () => {
      const after = await ctx.store.load('user');
      expect(after!.records).toHaveLength(before!.records.length);
    });
  });

  it('"reset all entities" in the list header regenerates every entity', async () => {
    const ctx = await renderDevtools();
    openPanel();
    await openList();
    fireEvent.click(screen.getByRole('button', { name: 'Reset all entities' }));

    await waitFor(async () => {
      const after = await ctx.store.load('user');
      expect(after!.records).toHaveLength(3);
    });
  });

  it('toggling "highlight mock data" masks a known value in the DOM and restores it on untoggle', async () => {
    const ctx = await makeCtx();
    const stored = await ctx.store.load('user');
    const knownName = String(stored!.records[0]!.name);

    document.body.innerHTML = '';
    const probe = document.createElement('div');
    probe.textContent = knownName;
    document.body.appendChild(probe);

    render(
      <MockProvider worker={fakeWorker()} ctx={ctx} storageKey={null}>
        <MockDevtools />
      </MockProvider>,
    );
    openPanel();
    const maskSwitch = screen.getByRole('switch', { name: 'Highlight mock data' });

    fireEvent.click(maskSwitch);
    await waitFor(() => expect(probe.textContent).toBe('*'.repeat(knownName.length)));

    fireEvent.click(maskSwitch);
    await waitFor(() => expect(probe.textContent).toBe(knownName));

    document.body.removeChild(probe);
  });

  it('"highlight mock data" masks the app\'s content but never the devtools UI\'s own record viewer', async () => {
    const ctx = await makeCtx();
    const stored = await ctx.store.load('user');
    const knownName = String(stored!.records[0]!.name);

    document.body.innerHTML = '';
    const probe = document.createElement('div');
    probe.textContent = knownName;
    document.body.appendChild(probe);

    render(
      <MockProvider worker={fakeWorker()} ctx={ctx} storageKey={null}>
        <MockDevtools />
      </MockProvider>,
      { container: document.body.appendChild(document.createElement('div')) },
    );

    openPanel();
    await openList();
    fireEvent.click(screen.getByRole('button', { name: 'Open user records' }));
    await waitFor(() => expect(screen.getByText(new RegExp(knownName))).toBeTruthy());

    // The data window stays open regardless of which page the anchored panel is on.
    fireEvent.click(screen.getByRole('button', { name: 'Back to settings' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Highlight mock data' }));

    await waitFor(() => expect(probe.textContent).toBe('*'.repeat(knownName.length)));
    // The same value rendered inside the data window's JSON viewer must survive untouched.
    expect(screen.getByText(new RegExp(knownName))).toBeTruthy();

    document.body.removeChild(probe);
  });
});
