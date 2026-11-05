import type { Prisma } from '../../../generated/prisma/client.js';
import { SharedReplaySchema } from '../../../platform/lifecycle/shared-replay.js';
import type { SharedReplay } from '../../../platform/lifecycle/shared-replay.js';
import { validateRoleDefaults } from '../domain/shared-policy.js';

/** Spaces captures only authorization/lifecycle metadata, never work bodies or live User identity. */
export async function captureSharedReplay(
  tx: Prisma.TransactionClient,
  event: {
    id: string;
    spaceId: string;
    version: string;
    action: string;
    resourceId: string | null;
    actorId: string | null;
  },
) {
  const c = await tx.sharedCustody.findUnique({
    where: { spaceId: event.spaceId },
  });
  const job = c
    ? await tx.sharedLifecycleJob.findUnique({
        where: {
          custodyId_generation: {
            custodyId: event.spaceId,
            generation: c.closureGeneration,
          },
        },
      })
    : await tx.sharedLifecycleJob.findFirst({
        where: { custodyId: event.spaceId, state: 'DELETED' },
        orderBy: { generation: 'desc' },
      });
  if (!c && !job) throw new Error('Missing replay custody evidence');
  const scope =
    c &&
    (await tx.accessScope.findUniqueOrThrow({ where: { id: event.spaceId } }));
  const policy = scope
    ? await tx.contextCapabilityPolicy.findUniqueOrThrow({
        where: {
          spaceId_scopeId_version: {
            spaceId: event.spaceId,
            scopeId: event.spaceId,
            version: scope.currentPolicyVersion,
          },
        },
      })
    : null;
  const accesses = c
    ? await tx.contextAccess.findMany({
        where: {
          spaceId: event.spaceId,
          OR: [
            ...(event.resourceId
              ? [{ id: event.resourceId }, { actorId: event.resourceId }]
              : []),
            ...(event.actorId ? [{ actorId: event.actorId }] : []),
            ...(c.primaryOwnerAccessId ? [{ id: c.primaryOwnerAccessId }] : []),
          ],
        },
      })
    : [];
  const rows = [];
  for (const a of accesses) {
    const actor = await tx.sharedActor.findUniqueOrThrow({
      where: { id: a.actorId },
    });
    rows.push({
      id: a.id,
      actorId: a.actorId,
      state: a.state,
      memberRole: a.memberRole,
      generation: a.generation,
      joinedAt: a.joinedAt.toISOString(),
      endedAt: a.endedAt?.toISOString() ?? null,
      erased: actor.state === 'ERASED',
    });
  }
  return SharedReplaySchema.parse({
    kind: 'REPLAY',
    id: event.id,
    spaceId: event.spaceId,
    version: event.version,
    action: event.action,
    resourceId: event.resourceId,
    custody: c
      ? {
          state: c.state,
          primaryOwnerAccessId: c.primaryOwnerAccessId,
          closureGeneration: c.closureGeneration,
          retentionPolicyVersion: c.retentionPolicyVersion,
        }
      : {
          state: 'DELETED',
          primaryOwnerAccessId: null,
          closureGeneration: job!.generation,
          retentionPolicyVersion: job!.retentionPolicyVersion,
        },
    policy: policy
      ? {
          version: policy.version,
          roleDefaults: policy.roleDefaults,
          exportMaxRecords: policy.exportMaxRecords,
          exportMaxBytes: policy.exportMaxBytes,
          publishedByActorId: policy.publishedByActorId,
          auditId: policy.auditId,
        }
      : null,
    accesses: rows,
    job: job
      ? {
          id: job.id,
          generation: job.generation,
          state: job.state,
          effectiveDepartureAt: job.effectiveDepartureAt.toISOString(),
          recoveryDeadline: job.recoveryDeadline.toISOString(),
          retentionPolicyVersion: job.retentionPolicyVersion,
          nextAt: job.nextAt.toISOString(),
          revision: job.revision,
          progress: job.progress,
        }
      : null,
  });
}

/** Replay is restrictive: it never creates identities, absent memberships or grants. */
export async function applySharedReplay(
  tx: Prisma.TransactionClient,
  r: SharedReplay,
) {
  const spaceId = r.spaceId;
  const c = await tx.sharedCustody.findUniqueOrThrow({ where: { spaceId } });
  if (c.retentionPolicyVersion !== r.custody.retentionPolicyVersion)
    throw new Error('Replay retention policy mismatch');
  const recovering = r.action === 'lifecycle.recover';
  const deleted = r.custody.state === 'DELETED';
  if (deleted) {
    const oldAccess = await tx.contextAccess.findMany({
      where: { spaceId, state: { in: ['ACTIVE', 'SUSPENDED'] } },
    });
    for (const a of oldAccess) {
      const endedAt = new Date(Math.max(Date.now(), a.joinedAt.getTime()));
      await tx.contextAccess.update({
        where: { id: a.id },
        data: { state: 'LEFT', endedAt, revision: { increment: 1 } },
      });
      await tx.contextAccessInterval.updateMany({
        where: { accessId: a.id, generation: a.generation, endedAt: null },
        data: { endedAt },
      });
    }
  }
  for (const a of recovering ? [] : r.accesses) {
    const old = await tx.contextAccess.findFirst({
      where: { id: a.id, spaceId, actorId: a.actorId },
    });
    if (!old) {
      if (a.id === r.custody.primaryOwnerAccessId)
        throw new Error(
          'Replay custodian absent; compatible snapshot required',
        );
      continue;
    }
    // Later admission requires explicit current consent. Do not revive an older generation.
    if (old.generation !== a.generation)
      throw new Error(
        'Replay admission generation differs; compatible snapshot required',
      );
    if (old.joinedAt.toISOString() !== a.joinedAt)
      throw new Error('Replay interval mismatch');
    if (
      ['LEFT', 'REVOKED', 'ERASED'].includes(old.state) &&
      ['ACTIVE', 'SUSPENDED'].includes(a.state)
    )
      throw new Error('Replay cannot revive ended admission');
    const endedAt = a.endedAt ? new Date(a.endedAt) : null;
    await tx.contextAccess.update({
      where: { id: old.id },
      data: {
        state: a.state,
        memberRole: a.memberRole,
        endedAt,
        revision: { increment: 1 },
      },
    });
    if (endedAt)
      await tx.contextAccessInterval.updateMany({
        where: { accessId: old.id, generation: old.generation, endedAt: null },
        data: { endedAt },
      });
    if (a.erased)
      await tx.sharedActor.update({
        where: { id: a.actorId },
        data: { userId: null, state: 'ERASED', erasedAt: new Date() },
      });
  }
  // Outstanding proofs and prior grants are never revived by a restored snapshot.
  const now = new Date();
  await tx.resourceGrant.updateMany({
    where: { spaceId, revokedAt: null },
    data: { revokedAt: now, revision: { increment: 1 } },
  });
  await tx.resourceGrantOffer.updateMany({
    where: { spaceId, state: 'PENDING' },
    data: {
      state: 'REVOKED',
      endedAt: now,
      proofHash: null,
      revision: { increment: 1 },
    },
  });
  await tx.contextInvitation.updateMany({
    where: { spaceId, state: 'PENDING' },
    data: {
      state: 'REVOKED',
      endedAt: now,
      proofHash: null,
      recipientUserId: null,
      recipientEmail: null,
      revision: { increment: 1 },
    },
  });
  await tx.ownerHandover.updateMany({
    where: { spaceId, state: 'PENDING' },
    data: { state: 'REVOKED', endedAt: now, revision: { increment: 1 } },
  });
  if (r.policy) {
    if (!validateRoleDefaults(r.policy.roleDefaults))
      throw new Error('Invalid replay capability ceiling');
    const p = r.policy,
      prior = await tx.contextCapabilityPolicy.findUnique({
        where: {
          spaceId_scopeId_version: {
            spaceId,
            scopeId: spaceId,
            version: p.version,
          },
        },
      });
    if (
      prior &&
      (JSON.stringify(prior.roleDefaults) !== JSON.stringify(p.roleDefaults) ||
        prior.exportMaxRecords !== p.exportMaxRecords ||
        prior.exportMaxBytes !== p.exportMaxBytes)
    )
      throw new Error('Conflicting immutable replay policy');
    if (!prior)
      await tx.contextCapabilityPolicy.create({
        data: { ...p, spaceId, scopeId: spaceId },
      });
    await tx.accessScope.update({
      where: { id: spaceId },
      data: { currentPolicyVersion: p.version },
    });
  }
  if (r.job && !recovering) {
    const j = r.job;
    const data = {
      spaceId,
      generation: j.generation,
      state: deleted ? 'CLEANUP_PENDING' : j.state,
      effectiveDepartureAt: new Date(j.effectiveDepartureAt),
      recoveryDeadline: new Date(j.recoveryDeadline),
      retentionPolicyVersion: j.retentionPolicyVersion,
      nextAt: new Date(j.nextAt),
      recoveryHash: null,
      leaseUntil: null,
      progress: { ...j.progress, stage: 'FILES' },
      revision: j.revision,
    };
    // Restart destructive work from its owner-controlled beginning; never restore a stale file lease/proof.
    await tx.sharedLifecycleJob.upsert({
      where: { id: j.id },
      create: { ...data, id: j.id, custodyId: spaceId },
      update: data,
    });
  }
  await tx.sharedCustody.update({
    where: { spaceId },
    data: {
      ...(recovering ? {} : r.custody),
      ...(deleted ? { state: 'CLEANUP_PENDING' } : {}),
      authorizationVersion: BigInt(r.version),
      revision: { increment: 1 },
    },
  });
  await tx.accessScope.updateMany({
    where: { spaceId },
    data: {
      ...(!recovering && ['ACTIVE', 'ARCHIVED'].includes(r.custody.state)
        ? { state: r.custody.state }
        : {}),
      authorizationVersion: BigInt(r.version),
    },
  });
}
