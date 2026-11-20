import { expect, it } from 'vitest';
import {
  RETENTION_CATALOG_V2_PENDING,
  RETENTION_CATALOG_V2_VERSIONS,
  buildRetentionCatalogV2,
} from '../retention/catalog-v2.ts';
import { RETENTION_CATALOG_V1 } from '../retention/catalog-v1.ts';

const approval = {
  approvalReference: 'OWNER-RPC-v2.0 signed record',
  accountableOperator: 'Accountable operator role',
};

it('declares exactly 7-day recovery under new immutable versions', () => {
  const catalog = buildRetentionCatalogV2(approval);
  expect(catalog.map((p) => p.policyVersion)).toEqual([
    ...RETENTION_CATALOG_V2_VERSIONS,
  ]);
  for (const p of catalog) {
    expect(p.sharedRecoverySeconds).toBe(7 * 86400);
    expect(p.approvalReference).toBe(approval.approvalReference);
  }
  const v1 = new Set(RETENTION_CATALOG_V1.map((p) => p.policyVersion));
  expect(catalog.some((p) => v1.has(p.policyVersion))).toBe(false);
  for (const p of RETENTION_CATALOG_V1)
    expect(p.sharedRecoverySeconds).toBe(30 * 86400);
});

it('keeps class retention separate from the recovery window', () => {
  const byVersion = Object.fromEntries(
    buildRetentionCatalogV2(approval).map((p) => [p.policyVersion, p]),
  );
  expect(
    byVersion['mp-rpc-v2.0-conversation']!.classRules.workContent
      .retainAfterClosureSeconds,
  ).toBe(3 * 365 * 86400);
  expect(
    byVersion['mp-rpc-v2.0-meeting']!.classRules.workContent
      .retainAfterClosureSeconds,
  ).toBe(5 * 365 * 86400);
});

it('never defaults or accepts placeholder approvals and seeds no Company policy', () => {
  for (const bad of [
    '',
    'SYNTHETIC',
    'pending owner',
    'TBD',
    'development only',
  ])
    expect(() =>
      buildRetentionCatalogV2({ ...approval, approvalReference: bad }),
    ).toThrow();
  expect(() =>
    buildRetentionCatalogV2({ ...approval, accountableOperator: 'TODO' }),
  ).toThrow();
  const contexts = buildRetentionCatalogV2(approval).flatMap(
    (p) => p.applicableContexts as string[],
  );
  expect(contexts).not.toContain('COMPANY');
  expect(RETENTION_CATALOG_V2_PENDING[0].context).toBe('COMPANY');
});
