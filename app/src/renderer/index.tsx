import React from 'react';
import { createRoot } from 'react-dom/client';
import 'katex/dist/katex.min.css';
import './styles.css';
import App from './App';

const container = document.getElementById('root');
if (!container) throw new Error('Marmot: #root is missing');

createRoot(container).render(<App />);

// Give the screenshot harness a stable signal that the first screen is ready.
requestAnimationFrame(() => {
  document.documentElement.dataset.ready = '1';
});
