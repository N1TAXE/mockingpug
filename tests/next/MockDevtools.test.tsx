// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MockDevtools } from '../../src/next/MockDevtools.js';

afterEach(() => {
  cleanup();
});

function stubFetch(docsEnabled: boolean) {
  return vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      json: async () => ({ entities: {}, runtime: { delay: 0, errorRate: 0 }, docsEnabled }),
    }),
  );
}

function openPanel() {
  fireEvent.click(screen.getByRole('button', { name: 'Open mockingpug devtools' }));
}

describe('<MockDevtools> (next) API Docs button', () => {
  it('shows "API Docs" and opens {baseUrl}/__mockingpug/docs in a new tab when enabled', async () => {
    stubFetch(true);
    const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null);
    try {
      render(<MockDevtools baseUrl="/api" />);
      openPanel();

      await waitFor(() => expect(screen.getByRole('button', { name: 'API Docs' })).toBeTruthy());
      fireEvent.click(screen.getByRole('button', { name: 'API Docs' }));

      expect(windowOpen).toHaveBeenCalledWith('/api/__mockingpug/docs', '_blank', 'noopener,noreferrer');
    } finally {
      windowOpen.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('hides "API Docs" when the server reports docsEnabled: false', async () => {
    stubFetch(false);
    render(<MockDevtools />);
    openPanel();

    await waitFor(() => expect(screen.getByRole('button', { name: /Mock Data/ })).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'API Docs' })).toBeNull();
    vi.unstubAllGlobals();
  });
});

/** Routes by URL/method, so the "Requests" view's log + request-bypass calls can be exercised, not just the root snapshot. */
function stubRoutedFetch(requestBypassAvailable: boolean) {
  const bypassedKeys = new Set<string>();
  const requests = [{ method: 'GET', path: '/api/user/1', status: 200, durationMs: 5, timestamp: 1 }];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.endsWith('/__mockingpug')) {
      return { json: async () => ({ entities: { user: 1 }, runtime: { delay: 0, errorRate: 0 }, docsEnabled: true, requestBypassAvailable }) } as Response;
    }
    if (url.endsWith('/__mockingpug/requests') && method === 'GET') {
      return { json: async () => ({ requests }) } as Response;
    }
    if (url.endsWith('/__mockingpug/requestBypass') && method === 'GET') {
      return { json: async () => ({ keys: [...bypassedKeys] }) } as Response;
    }
    if (url.endsWith('/__mockingpug/requestBypass') && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { method: string; pathname: string; bypassed: boolean };
      const key = `${body.method} ${body.pathname}`;
      if (body.bypassed) bypassedKeys.add(key);
      else bypassedKeys.delete(key);
      return { json: async () => ({ bypassed: body.bypassed }) } as Response;
    }
    throw new Error(`unhandled fetch: ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('<MockDevtools> (next) request bypass', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the "Use real data" toggle in the Requests view once the server reports requestBypassAvailable: true, and POSTs on toggle', async () => {
    const fetchMock = stubRoutedFetch(true);
    render(<MockDevtools baseUrl="/api" />);
    openPanel();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Requests' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Requests' }));
    await waitFor(() => expect(screen.getByText('/api/user/1')).toBeTruthy());

    const toggle = await waitFor(() => screen.getByRole('switch', { name: 'Use real data for GET /api/user/1' }));
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(toggle);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/__mockingpug/requestBypass',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ method: 'GET', pathname: '/api/user/1', bypassed: true }) }),
      ),
    );
  });

  it('hides the "Use real data" toggle when the server reports requestBypassAvailable: false', async () => {
    stubRoutedFetch(false);
    render(<MockDevtools baseUrl="/api" />);
    openPanel();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Requests' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Requests' }));
    await waitFor(() => expect(screen.getByText('/api/user/1')).toBeTruthy());

    expect(screen.queryByRole('switch', { name: 'Use real data for GET /api/user/1' })).toBeNull();
  });
});
