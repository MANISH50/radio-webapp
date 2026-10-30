import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { startSession } from './api/client';
import { App } from './App';
import './index.css';

// Obtain the session token as soon as the page loads; API calls wait for it if needed.
void startSession().catch(() => undefined);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
