import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

async function bootstrap() {
  if (import.meta.env.DEV) {
    const [{ startMocking }, { MockProvider, MockDevtools }] = await Promise.all([
      import('./mocks/browser'),
      import('mockingpug/react'),
    ]);
    const { ctx, worker } = await startMocking();

    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <MockProvider worker={worker} ctx={ctx}>
          <App />
          <MockDevtools />
        </MockProvider>
      </StrictMode>,
    )
    return;
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

bootstrap();
