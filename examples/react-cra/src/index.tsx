import React from 'react';
import ReactDOM from 'react-dom/client';
import type * as Mockingpug from 'mockingpug/react';
import type { SetupWorker } from 'msw/browser';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

interface MockingSetup {
  ctx: Mockingpug.QueryContext;
  worker: SetupWorker;
  MockProvider: typeof Mockingpug.MockProvider;
  MockDevtools: typeof Mockingpug.MockDevtools;
}

function render(mocking?: MockingSetup) {
  const root = ReactDOM.createRoot(
    document.getElementById('root') as HTMLElement
  );
  const app = mocking ? (
    <mocking.MockProvider worker={mocking.worker} ctx={mocking.ctx}>
      <App />
      <mocking.MockDevtools />
    </mocking.MockProvider>
  ) : (
    <App />
  );
  root.render(<React.StrictMode>{app}</React.StrictMode>);
  reportWebVitals();
}

// `import.meta.env` (used in the Vite example) is Vite-only syntax and
// doesn't parse under CRA's webpack config — see react/README.md's "CRA /
// webpack gotcha". `process.env.NODE_ENV` is the CRA/webpack equivalent.
if (process.env.NODE_ENV !== 'production') {
  Promise.all([import('./mocks/browser'), import('mockingpug/react')]).then(
    ([{ startMocking }, { MockProvider, MockDevtools }]) =>
      startMocking().then(({ ctx, worker }) => render({ ctx, worker, MockProvider, MockDevtools })),
  );
} else {
  render();
}
