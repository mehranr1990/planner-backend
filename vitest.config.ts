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
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['apps/api/test/integration/**/*.spec.ts'],
          fileParallelism: false,
          testTimeout: 15000,
        },
      },
    ],
  },
});
