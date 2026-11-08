import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../generated/prisma/client.js';
import { SharedReplaySchema } from '../../../platform/lifecycle/shared-replay.js';
import {
  captureSharedReplay,
  applySharedReplay,
} from './shared-replay-state.js';

const transfer = {
  id: randomUUID(),
  companyId: randomUUID(),
  sourceCustodyId: randomUUID(),
  sourceProjectId: randomUUID(),
  sourceOwnerAccessId: randomUUID(),
  manifestHash: 'a'.repeat(64),
  sourceVersion: 8n,
  retentionPolicyVersion: 'synthetic-policy',
};
const event = {
  id: transfer.id,
  spaceId: transfer.sourceCustodyId,
  version: '9',
  action: 'company.custody.transfer.retire',
  resourceId: transfer.id,
  actorId: null,
};
const fixture = () => {
  const find = vi.fn().mockResolvedValue(transfer);
  const tx = {
    sharedCustody: { findUnique: vi.fn().mockResolvedValue(null) },
    companyCustodyTransfer: { findFirst: find },
  } as unknown as Prisma.TransactionClient;
  return { tx, find };
};
it('records transfer retirement separately from erasure and rejects independent-only replay readers', async () => {
  const { tx, find } = fixture();
  const proof = await captureSharedReplay(tx, event);
  expect(find).toHaveBeenCalledWith({
    where: { sourceCustodyId: event.spaceId, state: 'APPLIED' },
  });
  expect(proof.retiredToCompany).toEqual({
    transferId: transfer.id,
    companyId: transfer.companyId,
    manifestHash: transfer.manifestHash,
    sourceKind: 'PROJECT',
  });
  expect(proof.companyChildCustody).toBe('V1');
  expect(proof.custody.state).toBe('OWNER_EXIT_FROZEN');
  expect(proof.policy).toBeNull();
  expect(proof.accesses).toEqual([]);
  expect(proof.job).toBeNull();
  const independentOnlyReader = SharedReplaySchema.omit({
    companyChildCustody: true,
    retiredToCompany: true,
  });
  expect(independentOnlyReader.safeParse(proof).success).toBe(false);
  expect(
    SharedReplaySchema.safeParse({
      ...proof,
      retiredToCompany: { ...proof.retiredToCompany, manifestHash: 'invalid' },
    }).success,
  ).toBe(false);
});
it('never reconstructs source ownership, admissions or graph locations from a retirement witness', async () => {
  const { tx } = fixture();
  const proof = await captureSharedReplay(tx, event);
  // No DB methods exist: rejection must precede every mutation or identity lookup.
  await expect(
    applySharedReplay({} as Prisma.TransactionClient, proof),
  ).rejects.toThrow('compatible transferred snapshot');
  for (const mismatch of [
    { id: randomUUID() },
    { resourceId: randomUUID() },
    { version: '8' },
    { action: 'custody.delete' },
  ])
    await expect(
      captureSharedReplay(tx, { ...event, ...mismatch }),
    ).rejects.toThrow('Conflicting custody retirement evidence');
});
