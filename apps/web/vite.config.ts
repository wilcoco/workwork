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

const ENV_COMMIT = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || '';
const ENV_TITLE = (process.env as any).RAILWAY_GIT_COMMIT_MESSAGE || (process.env as any).VERCEL_GIT_COMMIT_MESSAGE || '';
const ENV_DATE = (process.env as any).RAILWAY_GIT_COMMIT_TIME || (process.env as any).VERCEL_GIT_COMMIT_TIMESTAMP || '';

const short = (s: string) => (s ? s.slice(0, 7) : '');

const GIT_COMMIT = safe('git rev-parse --short HEAD') || short(ENV_COMMIT);
const GIT_TITLE = safe('git log -1 --pretty=%s') || ENV_TITLE || (ENV_COMMIT ? safe(`git show -s --format=%s ${ENV_COMMIT}`) : '');
const GIT_DATE = safe('git log -1 --date=iso-local --pretty=%cd') || ENV_DATE || new Date().toISOString();

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
    allowedHosts: true,
  },
});
