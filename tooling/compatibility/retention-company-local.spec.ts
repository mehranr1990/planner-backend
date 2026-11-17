import { expect, it, vi } from 'vitest';
import {
  LOCAL_COMPANY_POLICY as policy,
  localCompanyEnvironment,
  seedLocalCompanyPolicy,
} from '../retention/local-company.ts';
import { RETENTION_CATALOG_V1 } from '../retention/catalog-v1.ts';

const env = {
  NODE_ENV: 'development',
  SHARED_LOCAL_DEVELOPMENT_TEST_MODE: 'true',
  DATABASE_URL: 'postgresql://localhost/mehran_dev',
  BETTER_AUTH_URL: 'http://localhost:3000',
  BETTER_AUTH_SECRET: 'synthetic-unit-secret-at-least-32-characters',
};

it('copies only approved class controls without adding Company to the general seed', () => {
  expect(policy.classRules).toEqual(RETENTION_CATALOG_V1[0]!.classRules);
  expect(policy.sharedRecoverySeconds).toBe(2592000);
  expect(policy.applicableContexts).toEqual(['COMPANY']);
  expect(policy.holds).toEqual([]);
  expect(policy.obligations).toEqual([]);
  expect(
    RETENTION_CATALOG_V1.flatMap((p) => p.applicableContexts),
  ).not.toContain('COMPANY');
});

it('refuses unsafe environments before database access', async () => {
  expect(localCompanyEnvironment(env).NODE_ENV).toBe('development');
  const client = { $transaction: vi.fn() };
  for (const override of [
    { NODE_ENV: undefined },
    { NODE_ENV: 'production' },
    { NODE_ENV: 'test' },
    { SHARED_LOCAL_DEVELOPMENT_TEST_MODE: 'false' },
    { DATABASE_URL: 'postgresql://remote.invalid/mehran_dev' },
    { DATABASE_URL: 'postgresql://localhost/mehran_test' },
    { DATABASE_URL: 'postgresql://localhost/production' },
    { DATABASE_URL: 'postgresql://localhost/mehran_dev?host=remote.invalid' },
    { DATABASE_URL: 'postgresql://localhost/mehran_dev#options' },
    { HOST: '0.0.0.0' },
    { BETTER_AUTH_URL: 'http://remote.invalid' },
    { CORS_ORIGINS: 'http://remote.invalid' },
  ]) {
    await expect(
      seedLocalCompanyPolicy(client, { ...env, ...override }, true),
    ).rejects.toThrow();
  }
  expect(client.$transaction).not.toHaveBeenCalled();
});

it('dry-runs, inserts only missing versions, and refuses conflicts without overwriting', async () => {
  const findUnique = vi.fn().mockResolvedValue(null),
    create = vi.fn();
  const tx = { sharedRetentionPolicy: { findUnique, create } };
  const client = {
    $transaction: vi.fn(
      async (fn: (transaction: typeof tx) => Promise<string>) => fn(tx),
    ),
  } as unknown as Parameters<typeof seedLocalCompanyPolicy>[0];
  expect(await seedLocalCompanyPolicy(client, env, false)).toBe('PLANNED');
  expect(create).not.toHaveBeenCalled();
  expect(await seedLocalCompanyPolicy(client, env, true)).toBe('INSERTED');
  expect(create).toHaveBeenCalledOnce();
  create.mockClear();
  findUnique.mockResolvedValue({
    configuration: policy,
    approvalReference: policy.approvalReference,
  });
  expect(await seedLocalCompanyPolicy(client, env, true)).toBe('UNCHANGED');
  findUnique.mockResolvedValue({
    configuration: { ...policy, holds: ['tampered'] },
    approvalReference: policy.approvalReference,
  });
  expect(await seedLocalCompanyPolicy(client, env, true)).toBe('CONFLICT');
  expect(create).not.toHaveBeenCalled();
});
