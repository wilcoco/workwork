import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

function safe(cmd: string): string {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

const GIT_COMMIT = safe('git rev-parse --short HEAD');
const GIT_TITLE = safe('git log -1 --pretty=%s');
const GIT_DATE = safe('git log -1 --date=iso-local --pretty=%cd');

export default defineConfig({
  define: {
    'import.meta.env.VITE_GIT_COMMIT': JSON.stringify(GIT_COMMIT),
    'import.meta.env.VITE_GIT_TITLE': JSON.stringify(GIT_TITLE),
    'import.meta.env.VITE_GIT_DATE': JSON.stringify(GIT_DATE),
  },
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: true,
    allowedHosts: ['workworkweb-production.up.railway.app'],
  },
});
