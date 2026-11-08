import { expect, it, vi } from 'vitest';
import type { Prisma } from '../../../generated/prisma/client.js';
import { SharedAuthority } from '../public/shared-authority.js';
import type { SharedAccess } from '../public/shared-authority.js';
import { SharedKernel } from './shared-kernel.service.js';

// These methods use only the supplied transaction and current authority.
const kernel = Object.create(SharedKernel.prototype) as SharedKernel;
const proof = (scopeId: string, generation = 2): SharedAccess => ({
  spaceId: 'company',
  scopeId,
  actorId: 'canonical',
  accessId: 'current',
  generation,
  role: 'MEMBER',
  capability: 'task.read',
  authorizationVersion: 7n,
});

it('does not look up historical actors with Company-root, sibling, expired or wrong-resource authority', async () => {
  const lookup = vi.fn().mockResolvedValue([]);
  const tx = {
    domainScopeActorAlias: { findMany: lookup },
  } as unknown as Prisma.TransactionClient;
  for (const source of ['company', 'project-b']) {
    await expect(
      kernel.historicalActors(
        tx,
        new SharedAuthority(tx, [proof(source)]),
        'project-a',
      ),
    ).rejects.toThrow();
  }
  const resource = { kind: 'TASK' as const, id: 'task-a' };
  const a = new SharedAuthority(tx, [{ ...proof('project-a'), resource }]);
  await expect(
    kernel.historicalActors(tx, a, 'project-a', { kind: 'TASK', id: 'task-b' }),
  ).rejects.toThrow();
  expect(lookup).not.toHaveBeenCalled();
  await expect(
    kernel.historicalActors(tx, a, 'project-a', resource),
  ).resolves.toEqual(['canonical']);
  expect(lookup).toHaveBeenCalledWith({
    where: {
      spaceId: 'company',
      scopeId: 'project-a',
      canonicalActorId: 'canonical',
      transfer: { state: 'APPLIED' },
    },
    select: { historicalActorId: true },
  });
  a.close();
  lookup.mockClear();
  await expect(
    kernel.historicalActors(tx, a, 'project-a', resource),
  ).rejects.toThrow();
  expect(lookup).not.toHaveBeenCalled();
});

it('binds historical audiences to the current admission generation and an applied transfer', async () => {
  const lookup = vi
    .fn()
    .mockResolvedValue([
      { historicalAccessId: 'old', historicalGeneration: 3 },
    ]);
  const tx = {
    domainScopeAdmissionAlias: { findMany: lookup },
  } as unknown as Prisma.TransactionClient;
  const a = new SharedAuthority(tx, [proof('project-a')]);
  expect(
    await kernel.audienceMatches(tx, a, 'project-a', {
      accessId: 'old',
      generation: 3,
    }),
  ).toBe(true);
  expect(
    await kernel.audienceMatches(tx, a, 'project-a', {
      accessId: 'old',
      generation: 2,
    }),
  ).toBe(false);
  expect(lookup).toHaveBeenCalledWith({
    where: {
      spaceId: 'company',
      scopeId: 'project-a',
      destinationAccessId: 'current',
      destinationGeneration: 2,
      transfer: { state: 'APPLIED' },
    },
    select: { historicalAccessId: true, historicalGeneration: true },
  });
  lookup.mockResolvedValue([]);
  const readmitted = new SharedAuthority(tx, [proof('project-a', 4)]);
  expect(
    await kernel.audienceMatches(tx, readmitted, 'project-a', {
      accessId: 'old',
      generation: 3,
    }),
  ).toBe(false);
  expect(lookup.mock.lastCall![0].where.destinationGeneration).toBe(4);
});

it('rejects historical mappings from a different custody or an incomplete transfer', async () => {
  const alias = {
    spaceId: 'other-company',
    destinationAccessId: 'destination',
    destinationGeneration: 9,
    transferId: 'transfer',
  };
  const transfer = vi.fn().mockResolvedValue({ state: 'PREVIEWED' });
  const tx = {
    domainScopeAdmissionAlias: { findUnique: vi.fn().mockResolvedValue(alias) },
    companyCustodyTransfer: { findUnique: transfer },
  } as unknown as Prisma.TransactionClient;
  const a = new SharedAuthority(tx, [proof('project-a')]);
  const old = { accessId: 'historical', generation: 3 };
  await expect(
    kernel.historicalMember(tx, a, 'project-a', old),
  ).rejects.toThrow();
  expect(transfer).not.toHaveBeenCalled();
  alias.spaceId = 'company';
  await expect(
    kernel.historicalMember(tx, a, 'project-a', old),
  ).rejects.toThrow();
  transfer.mockResolvedValue({ state: 'APPLIED' });
  await expect(
    kernel.historicalMember(tx, a, 'project-a', old),
  ).resolves.toEqual({ accessId: 'destination', generation: 9 });
  expect(a.require(tx, 'project-a', 'task.read').accessId).toBe('current');
  expect(a.has(tx, 'project-b', 'task.read')).toBe(false);
});
