const { spawnSync } = require('child_process');
const path = require('path');

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db?schema=public';
}

const binName = process.platform === 'win32' ? 'prisma.cmd' : 'prisma';
const candidates = [
  path.resolve(__dirname, '..', 'node_modules', '.bin', binName),
  path.resolve(__dirname, '..', '..', '..', 'node_modules', '.bin', binName),
  'npx',
];

let status = 1;
for (const cmd of candidates) {
  const args = cmd === 'npx' ? ['prisma', 'generate', '--schema=./prisma/schema.prisma'] : ['generate', '--schema=./prisma/schema.prisma'];
  const r = spawnSync(cmd, args, { stdio: 'inherit', env: process.env });
  status = r.status || 0;
  if (status === 0) break;
}

process.exit(status);
