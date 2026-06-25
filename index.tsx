import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app';
import { registerPWAServiceWorker } from './lib/pwa';
import { bootstrapReaderSettings } from './lib/readerSettings';
import './styles/base.css';

bootstrapReaderSettings();
registerPWAServiceWorker();

const container = document.getElementById('app');
if (!container) {
  // Surface a clear failure mode if index.html is missing the mount node;
  // a bare `!` would silently throw later during createRoot with an opaque
  // stack and leave the page blank.
  throw new Error('weread: missing #app mount node in index.html');
}

const root = createRoot(container);
const routerBasename = import.meta.env.BASE_URL === '/' ? undefined : import.meta.env.BASE_URL.replace(/\/$/, '');

root.render(
  <BrowserRouter basename={routerBasename}>
    <App />
  </BrowserRouter>,
);
