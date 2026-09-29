import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { applyTheme, readTheme } from './app/theme';
import './styles.css';
import './ui/polish-core.css';
import './ui/site-polish.css';
import './ui/polish-core.js';

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');

// Apply the stored theme before the first render so Landing paints in it too.
applyTheme(readTheme());

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
