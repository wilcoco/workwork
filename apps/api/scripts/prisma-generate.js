const { spawnSync } = require('child_process');

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db?schema=public';
}

const r = spawnSync('npx', ['prisma', 'generate', '--schema=./prisma/schema.prisma'], {
  stdio: 'inherit',
  env: process.env,
});

process.exit(r.status || 0);
