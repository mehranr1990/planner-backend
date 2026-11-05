import { spawnSync } from 'node:child_process';
const result = spawnSync(
  process.execPath,
  ['tooling/scripts/p2-04-smoke.ts', '--p2-05', '--p2-06'],
  { env: process.env, stdio: 'inherit' },
);
process.exitCode = result.status ?? 1;
