// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountDevtoolsPanel, type DevtoolsPanelProps } from '../../src/shared/devtoolsPanel.js';

function setViewport(h: number, w = 1024) {
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true });
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
}

const props: DevtoolsPanelProps = {
  title: 'mockingpug',
  entities: { user: 3 },
  runtime: { delay: 0, errorRate: 0 },
  onRuntimeChange: () => {},
  onFetchRecords: async () => [{ id: 1 }],
  onResetEntity: async () => [],
  onUpdateRecord: async () => ({}),
  onFetchRequestLog: async () => [],
  onArmOneShotOverride: () => {},
  onPeekOneShotOverride: async () => undefined,
  onExportSnapshot: async () => ({}),
  onImportSnapshot: () => {},
  onCopyRecordCurl: () => {},
};

let handle: ReturnType<typeof mountDevtoolsPanel> | undefined;
let target: HTMLElement | undefined;

afterEach(() => { handle?.dispose(); target?.remove(); setViewport(768); });
beforeEach(() => { target = document.createElement('div'); document.body.appendChild(target); });

/** Open the first entity's data window and return its root element. */
function openWindow(): HTMLElement {
  (document.querySelector('[aria-label="Open mockingpug devtools"]') as HTMLElement).click();
  [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Mock Data'))!.click();
  (document.querySelector('[data-testid="entity-row-user"]') as HTMLElement).click();
  const close = document.querySelector('[aria-label="Close user window"]')!;
  return close.closest('div[style*="position: fixed"]') as HTMLElement;
}

describe('devtools data window position (R: short-viewport clamp)', () => {
  it('opens fully inside a short viewport (header + body reachable)', () => {
    setViewport(500);
    handle = mountDevtoolsPanel(target!, props);
    const win = openWindow();
    const top = parseInt(win.style.top, 10);
    const h = Math.min(420, 500 * 0.8); // 400
    expect(top).toBeGreaterThanOrEqual(8);
    expect(top + h).toBeLessThanOrEqual(500 - 8 + 1); // fully on screen (1px slack)
  });

  it('re-clamps an open window when the viewport shrinks', () => {
    setViewport(900);
    handle = mountDevtoolsPanel(target!, props);
    const win = openWindow();
    // Force it near the old bottom, then shrink the viewport and fire resize.
    win.style.top = '820px';
    setViewport(400);
    window.dispatchEvent(new Event('resize'));
    const top = parseInt(win.style.top, 10);
    const h = Math.min(420, 400 * 0.8); // 320
    expect(top + h).toBeLessThanOrEqual(400 - 8 + 1);
  });
});
