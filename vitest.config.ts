import { defineConfig } from 'vitest/config';

export default defineConfig({
  oxc: { decorator: { legacy: true, emitDecoratorMetadata: true } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: [
            'apps/api/src/**/*.spec.ts',
            'packages/api-contracts/src/**/*.spec.ts',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'contract',
          include: ['apps/api/test/contract/**/*.spec.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'architecture',
          include: ['tooling/architecture-tests/**/*.spec.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'compatibility',
          include: ['tooling/compatibility/**/*.spec.ts'],
          // Full-document hashing of the 1,092-operation API under concurrent workers.
          testTimeout: 15000,
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          // Owned-schema deployment now replays 101 migrations. Keep assertion
          // timeouts unchanged; allow bounded Windows/PostgreSQL bootstrap time.
          hookTimeout: 60000,
          globalSetup: ['tooling/testing/integration-setup.ts'],
          include: ['apps/api/test/integration/**/*.spec.ts'],
          fileParallelism: false,
          testTimeout: 15000,
        },
      },
    ],
  },
});
