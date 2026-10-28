import { pnpm } from './run.ts';

// Run all applicable checks once; retain failures without silently skipping later checks.
const steps = [
  'config:check',
  'db:generate',
  'auth:schema:check',
  'db:validate',
  'build',
  'typecheck',
  'format:check',
  'lint',
  'architecture',
  'test',
  'openapi:check',
  'test:integration',
  'db:migrations:check',
];
let failed = false;
for (const step of steps) {
  process.stdout.write(`\nBackend quality gate: ${step}\n`);
  const status = pnpm([step]);
  if (status !== 0) failed = true;
}
process.exitCode = failed ? 1 : 0;
