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

const filterableSchemas: SchemaBundle = {
  user: { name: 'user', file: 'x', amount: 1, data: { id: { kind: 'number', mode: 'increment' } } },
  blogpost: { name: 'blogpost', file: 'x', amount: 1, data: { id: { kind: 'number', mode: 'increment' } } },
  category: { name: 'category', file: 'x', amount: 1, data: { id: { kind: 'number', mode: 'increment' } } },
};

async function makeFilterableCtx(): Promise<QueryContext> {
  const store = new MemoryStoreAdapter();
  await generateAll(filterableSchemas, store, { seed: 'filter-test' });
  return { schemas: filterableSchemas, store, pagination: DEFAULT_CONFIG.pagination, seed: 'filter-test' };
}

function manyEntitySchemas(count: number): SchemaBundle {
  const bundle: SchemaBundle = {};
  for (let i = 0; i < count; i++) {
    const name = `entity${i}`;
    bundle[name] = { name, file: 'x', amount: 1, data: { id: { kind: 'number', mode: 'increment' } } };
  }
  return bundle;
}

async function makeManyEntitiesCtx(count: number): Promise<QueryContext> {
  const schemas = manyEntitySchemas(count);
  const store = new MemoryStoreAdapter();
  await generateAll(schemas, store, { seed: 'many-entities-test' });
  return { schemas, store, pagination: DEFAULT_CONFIG.pagination, seed: 'many-entities-test' };
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

/**
 * The JSON viewer's syntax highlighting splits its text across several
 * `<span>` children, so a plain `getByText(regex)` matches both the `<pre>`
 * (whose aggregated `textContent` contains the text) and, often, one of
 * those inner spans too, throwing "multiple elements found". Restricting
 * the match to a `<pre>` element itself sidesteps that half of the
 * problem. The other half: the read-only view renders one `<pre>` per
 * record (not one big array blob), so a bare id like `"1"` can also match
 * an unrelated record's `_index`/other numeric field — callers matching by
 * id should search for `"id": <id>` instead of the bare id to stay scoped
 * to that one record's `<pre>`.
 */
function preContains(text: string) {
  return screen.getByText((_, element) => element?.tagName === 'PRE' && (element.textContent ?? '').includes(text));
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
      expect(preContains(`"id": ${stored!.records[0]!.id}`)).toBeTruthy();
    });
  });

  it('opening an entity from the list shows its stored records in a floating window', async () => {
    const ctx = await renderDevtools();
    openPanel();
    await openList();
    fireEvent.click(screen.getByRole('button', { name: 'Open user records' }));

    const stored = await ctx.store.load('user');
    await waitFor(() => {
      expect(preContains(`"id": ${stored!.records[0]!.id}`)).toBeTruthy();
    });
  });

  it('the data window\'s close button actually closes it', async () => {
    const ctx = await renderDevtools();
    openPanel();
    await openList();
    fireEvent.click(screen.getByRole('button', { name: 'Open user records' }));

    const stored = await ctx.store.load('user');
    await waitFor(() => {
      expect(preContains(`"id": ${stored!.records[0]!.id}`)).toBeTruthy();
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

  it('invariant: the panel\'s own actions (reset) are unaffected by runtime.errorRate/delay, since it reads ctx in-process, not over fetch/MSW', async () => {
    const ctx = await renderDevtools();
    ctx.runtime = { errorRate: 1, delay: 2000 };
    const before = await ctx.store.load('user');

    openPanel();
    await openList();
    fireEvent.click(screen.getByRole('button', { name: 'Open user records' }));

    const startedAt = Date.now();
    fireEvent.click(await screen.findByRole('button', { name: 'Reset user' }));

    await waitFor(async () => {
      const after = await ctx.store.load('user');
      expect(after!.records).toHaveLength(before!.records.length);
    });
    expect(Date.now() - startedAt).toBeLessThan(2000);
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

  it('editing a record\'s JSON and saving persists the change to the store', async () => {
    const ctx = await renderDevtools();
    openPanel();
    await openList();
    fireEvent.click(screen.getByRole('button', { name: 'Open user records' }));

    const stored = await ctx.store.load('user');
    const firstId = stored!.records[0]!.id;
    await waitFor(() => expect(preContains(`"id": ${firstId}`)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Edit user records' }));
    const textarea = screen.getByLabelText('Edit user records as JSON') as HTMLTextAreaElement;
    const edited = JSON.parse(textarea.value) as Array<Record<string, unknown>>;
    edited[0]!.name = 'Edited By Devtools';
    fireEvent.change(textarea, { target: { value: JSON.stringify(edited, null, 2) } });

    fireEvent.click(screen.getByRole('button', { name: 'Save user changes' }));

    await waitFor(async () => {
      const after = await ctx.store.load('user');
      expect(after!.records.find((r) => r.id === firstId)?.name).toBe('Edited By Devtools');
    });
    // Back to the read-only viewer, reflecting the saved value.
    await waitFor(() => expect(preContains('Edited By Devtools')).toBeTruthy());
  });

  it('cancelling an edit discards changes without touching the store', async () => {
    const ctx = await renderDevtools();
    openPanel();
    await openList();
    fireEvent.click(screen.getByRole('button', { name: 'Open user records' }));

    const stored = await ctx.store.load('user');
    const firstId = stored!.records[0]!.id;
    await waitFor(() => expect(preContains(`"id": ${firstId}`)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Edit user records' }));
    const textarea = screen.getByLabelText('Edit user records as JSON') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'not valid json at all' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel editing user' }));

    expect(screen.queryByLabelText('Edit user records as JSON')).toBeNull();
    const after = await ctx.store.load('user');
    expect(after!.records.find((r) => r.id === firstId)?.name).toBe(stored!.records[0]!.name);
  });

  it('shows an error and keeps editing open when the JSON is invalid', async () => {
    const ctx = await renderDevtools();
    openPanel();
    await openList();
    fireEvent.click(screen.getByRole('button', { name: 'Open user records' }));

    const stored = await ctx.store.load('user');
    await waitFor(() => expect(preContains(`"id": ${stored!.records[0]!.id}`)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Edit user records' }));
    const textarea = screen.getByLabelText('Edit user records as JSON');
    fireEvent.change(textarea, { target: { value: '{ not valid json' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save user changes' }));

    await waitFor(() => expect(screen.getByText('Invalid JSON.')).toBeTruthy());
    expect(screen.getByLabelText('Edit user records as JSON')).toBeTruthy();
  });

  it('the Requests view shows "no requests yet" until something has been logged', async () => {
    await renderDevtools();
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Requests' }));
    await waitFor(() => expect(screen.getByText('No requests yet.')).toBeTruthy());
  });

  it('the Requests view lists logged requests, most-recent-first', async () => {
    const ctx = await renderDevtools();
    ctx.requestLog!.record({ method: 'GET', path: '/api/user', status: 200, durationMs: 5, timestamp: 1 });
    ctx.requestLog!.record({ method: 'POST', path: '/api/user', status: 201, durationMs: 8, timestamp: 2 });

    openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Requests' }));

    await waitFor(() => expect(screen.getAllByText('/api/user')).toHaveLength(2));
    // POST (timestamp 2) rendered before GET (timestamp 1): most-recent-first.
    expect(screen.getByText('201')).toBeTruthy();
    expect(screen.getByText('200')).toBeTruthy();
  });

  it('"Clear request log" empties the log and refreshes the view', async () => {
    const ctx = await renderDevtools();
    ctx.requestLog!.record({ method: 'GET', path: '/api/user', status: 200, durationMs: 5, timestamp: 1 });

    openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Requests' }));
    await waitFor(() => expect(screen.getByText('/api/user')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Clear request log' }));
    await waitFor(() => expect(screen.getByText('No requests yet.')).toBeTruthy());
  });

  it('the "Fail next request" switch arms and disarms a one-shot override for the open entity', async () => {
    const ctx = await renderDevtools();
    openPanel();
    await openList();
    fireEvent.click(screen.getByRole('button', { name: 'Open user records' }));

    const failSwitch = await screen.findByRole('switch', { name: 'Fail next user request' });
    await waitFor(() => expect(ctx.oneShotOverrides?.peek('user')).toBeUndefined());

    fireEvent.click(failSwitch);
    await waitFor(() => expect(ctx.oneShotOverrides?.peek('user')).toMatchObject({ failNext: true }));

    fireEvent.click(failSwitch);
    await waitFor(() => expect(ctx.oneShotOverrides?.peek('user')).toMatchObject({ failNext: false }));
  });

  it('"Arm" on "Delay next" sets a one-shot delay override for the open entity', async () => {
    const ctx = await renderDevtools();
    openPanel();
    await openList();
    fireEvent.click(screen.getByRole('button', { name: 'Open user records' }));

    const delayInput = await screen.findByLabelText('Delay next user request (ms)');
    fireEvent.change(delayInput, { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Arm' }));

    await waitFor(() => expect(ctx.oneShotOverrides?.peek('user')).toMatchObject({ delayNext: 250 }));
  });

  it('"Export" downloads the current store as a JSON snapshot file', async () => {
    const ctx = await renderDevtools();
    openPanel();
    await openList();

    let capturedBlob: Blob | null = null;
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      capturedBlob = blob as Blob;
      return 'blob:mock';
    });
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Export' }));
      await waitFor(() => expect(createObjectURL).toHaveBeenCalled());

      const snapshot = JSON.parse(await capturedBlob!.text()) as { user: { records: unknown[] } };
      const stored = await ctx.store.load('user');
      expect(snapshot.user.records).toEqual(stored!.records);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');
    } finally {
      createObjectURL.mockRestore();
      revokeObjectURL.mockRestore();
    }
  });

  it('"API Docs" opens a client-generated HTML API reference in a new tab', async () => {
    await renderDevtools();
    openPanel();

    let capturedBlob: Blob | null = null;
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      capturedBlob = blob as Blob;
      return 'blob:mock-docs';
    });
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null);
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole('button', { name: 'API Docs' }));

      expect(createObjectURL).toHaveBeenCalled();
      expect(windowOpen).toHaveBeenCalledWith('blob:mock-docs', '_blank', 'noopener,noreferrer');
      expect(capturedBlob!.type).toBe('text/html');
      const html = await capturedBlob!.text();
      expect(html).toContain('<!doctype html>');
      expect(html).toContain('<section id="entity-user"');

      await vi.advanceTimersByTimeAsync(60_000);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-docs');
    } finally {
      vi.useRealTimers();
      createObjectURL.mockRestore();
      revokeObjectURL.mockRestore();
      windowOpen.mockRestore();
    }
  });

  it('hides the "API Docs" row when ctx.docs.enabled is false', async () => {
    const ctx = await makeCtx();
    ctx.docs = { enabled: false };
    render(
      <MockProvider worker={fakeWorker()} ctx={ctx} storageKey={null}>
        <MockDevtools />
      </MockProvider>,
    );
    openPanel();
    expect(screen.queryByRole('button', { name: 'API Docs' })).toBeNull();
  });

  it('"Import" restores entities from a selected snapshot file and refreshes counts', async () => {
    const ctx = await renderDevtools();
    openPanel();
    await openList();

    const file = new File(
      [JSON.stringify({ user: { meta: { fields: {} }, records: [{ id: 1, name: 'Imported User' }] } })],
      'snapshot.json',
      { type: 'application/json' },
    );
    const input = screen.getByLabelText('Import snapshot file') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(async () => {
      const stored = await ctx.store.load('user');
      expect(stored!.records).toEqual([{ id: 1, name: 'Imported User' }]);
    });
    await waitFor(() => expect(screen.getByTestId('entity-row-user').textContent).toContain('(1)'));
  });

  it('"Import" shows an error for a file that is not valid JSON', async () => {
    await renderDevtools();
    openPanel();
    await openList();

    const file = new File(['not valid json'], 'snapshot.json', { type: 'application/json' });
    const input = screen.getByLabelText('Import snapshot file') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText('Invalid snapshot file.')).toBeTruthy());
  });

  it('the entity filter narrows the "Mock Data" list by name', async () => {
    const ctx = await makeFilterableCtx();
    render(
      <MockProvider worker={fakeWorker()} ctx={ctx} storageKey={null}>
        <MockDevtools />
      </MockProvider>,
    );
    openPanel();
    await openList();

    expect(screen.getByTestId('entity-row-user')).toBeTruthy();
    expect(screen.getByTestId('entity-row-blogpost')).toBeTruthy();
    expect(screen.getByTestId('entity-row-category')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Filter entities'), { target: { value: 'blog' } });

    expect(screen.getByTestId('entity-row-blogpost')).toBeTruthy();
    expect(screen.queryByTestId('entity-row-user')).toBeNull();
    expect(screen.queryByTestId('entity-row-category')).toBeNull();
  });

  it('shows "No matching entities." when the filter matches nothing', async () => {
    const ctx = await makeFilterableCtx();
    render(
      <MockProvider worker={fakeWorker()} ctx={ctx} storageKey={null}>
        <MockDevtools />
      </MockProvider>,
    );
    openPanel();
    await openList();

    fireEvent.change(screen.getByLabelText('Filter entities'), { target: { value: 'nope' } });
    expect(screen.getByText('No matching entities.')).toBeTruthy();
  });

  it('virtualizes the "Mock Data" list: only rows near the scroll position are rendered', async () => {
    const ctx = await makeManyEntitiesCtx(30);
    render(
      <MockProvider worker={fakeWorker()} ctx={ctx} storageKey={null}>
        <MockDevtools />
      </MockProvider>,
    );
    openPanel();
    await openList();

    // Scrolled to the top: an entity far down the list isn't in the DOM at all yet.
    expect(screen.getByTestId('entity-row-entity0')).toBeTruthy();
    expect(screen.queryByTestId('entity-row-entity25')).toBeNull();

    fireEvent.scroll(screen.getByTestId('entity-list-scroll'), { target: { scrollTop: 25 * 49 } });

    await waitFor(() => expect(screen.getByTestId('entity-row-entity25')).toBeTruthy());
    expect(screen.queryByTestId('entity-row-entity0')).toBeNull();
  });

  it('"Copy as curl" copies a GET curl command for that exact record\'s URL', async () => {
    const ctx = await renderDevtools();
    openPanel();
    await openList();
    fireEvent.click(screen.getByRole('button', { name: 'Open user records' }));

    const stored = await ctx.store.load('user');
    const id = stored!.records[0]!.id;
    await waitFor(() => expect(preContains(`"id": ${id}`)).toBeTruthy());

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    fireEvent.click(screen.getByRole('button', { name: `Copy curl for user ${id}` }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const command = writeText.mock.calls[0]![0] as string;
    expect(command).toMatch(new RegExp(`^curl -X GET '.*/api/user/${id}'$`));
  });

  it('does not show a "Copy as curl" button for a record with no resolvable id', async () => {
    const schemasNoId: SchemaBundle = {
      note: { name: 'note', file: 'x', amount: 1, data: { text: { kind: 'lorem' } } },
    };
    const store = new MemoryStoreAdapter();
    await generateAll(schemasNoId, store, { seed: 'no-id-test' });
    const ctx: QueryContext = { schemas: schemasNoId, store, pagination: DEFAULT_CONFIG.pagination, seed: 'no-id-test' };
    render(
      <MockProvider worker={fakeWorker()} ctx={ctx} storageKey={null}>
        <MockDevtools />
      </MockProvider>,
    );
    openPanel();
    await openList();
    fireEvent.click(screen.getByRole('button', { name: 'Open note records' }));

    await waitFor(() => expect(preContains('text')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Copy curl for note/ })).toBeNull();
  });
});
