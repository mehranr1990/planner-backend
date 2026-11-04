import { spawnSync } from 'node:child_process';
// Reuse the compiled owned-schema P2-04 runtime, restart and worker exercise.
const result = spawnSync(
  process.execPath,
  ['tooling/scripts/p2-04-smoke.ts', '--p2-05'],
  { env: process.env, stdio: 'inherit' },
);
process.exitCode = result.status ?? 1;
