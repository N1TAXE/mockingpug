import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

function render() {
  const root = ReactDOM.createRoot(
    document.getElementById('root') as HTMLElement
  );
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
  reportWebVitals();
}

// `import.meta.env` (used in the Vite example) is Vite-only syntax and
// doesn't parse under CRA's webpack config — see react/README.md's "CRA /
// webpack gotcha". `process.env.NODE_ENV` is the CRA/webpack equivalent.
if (process.env.NODE_ENV !== 'production') {
  import('./mocks/browser').then(({ startMocking }) => startMocking().then(render));
} else {
  render();
}
