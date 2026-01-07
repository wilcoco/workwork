import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/global.css';

const root = createRoot(document.getElementById('root')!);
// Prevent browser navigating away when dropping files outside editors
try {
  const preventIfNotEditor = (e: DragEvent) => {
    const t = e.target as HTMLElement | null;
    const withinQuill = t && (t.closest?.('.ql-editor') || t.closest?.('.quill-box'));
    if (!withinQuill && e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
      e.preventDefault();
    }
  };
  window.addEventListener('dragover', preventIfNotEditor as any, { passive: false } as any);
  window.addEventListener('drop', preventIfNotEditor as any, { passive: false } as any);
} catch {}
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
