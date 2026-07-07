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
