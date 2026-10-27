import { pnpm } from './run.ts';

// Run all applicable checks once; retain failures without silently skipping later checks.
const steps = [
  'config:check',
  'db:generate',
  'db:validate',
  'build',
  'typecheck',
  'format:check',
  'lint',
  'architecture',
  'test',
  'openapi:check',
  'test:integration',
];
let failed = false;
for (const step of steps) {
  process.stdout.write(`\nP0-01 gate: ${step}\n`);
  const status = pnpm([step]);
  if (status !== 0) failed = true;
}
process.exitCode = failed ? 1 : 0;
