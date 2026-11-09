import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { ExportBudget } from '../../../platform/lifecycle/personal-data.js';
import { MessagingAuthority } from '../../spaces/public/index.js';
import { MessagingData } from '../public/personal-data.js';
@Injectable()
export class MessagingDataRepository extends MessagingData {
  constructor(
    @Inject(MessagingAuthority) private readonly authority: MessagingAuthority,
  ) {
    super();
  }
  private async batches(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    work: (actors: string[]) => Promise<void>,
  ) {
    let after: string | undefined;
    for (;;) {
      const actors = await this.authority.ownedActors(tx, scope, after);
      if (!actors.length) return;
      await work(actors);
      after = actors.at(-1);
    }
  }
  override async suspend(tx: Prisma.TransactionClient, scope: AuthorizedSpace) {
    await this.batches(tx, scope, async (actors) => {
      const admission = { Member: { actorId: { in: actors } } };
      await tx.messagePersonalMutation.deleteMany({ where: { admission } });
      await tx.messageProgress.deleteMany({ where: { admission } });
      await tx.messageNoticePreference.deleteMany({ where: { admission } });
      await tx.messageNoticeAttempt.updateMany({
        where: {
          notice: { actorId: { in: actors } },
          state: { in: ['PENDING', 'PROCESSING', 'RETRY'] },
        },
        data: {
          state: 'CANCELED',
          canceledAt: new Date(),
          code: 'ACCOUNT_CLOSED',
        },
      });
      await tx.messageNoticeAttempt.updateMany({
        where: { notice: { actorId: { in: actors } }, state: 'NETWORK' },
        data: { canceledAt: new Date() },
      });
      await tx.messageNotice.updateMany({
        where: { actorId: { in: actors } },
        data: { state: 'CANCELED', inApp: false },
      });
    });
  }
  async erase(tx: Prisma.TransactionClient, scope: AuthorizedSpace) {
    await this.suspend(tx, scope);
    // PersonalLifecycle already durably claims and fences identity erasure.
    // Private cleanup must not require Shared activation or its signing keys.
    await tx.dmContactState.deleteMany({
      where: { ownerUserId: scope.actor.userId },
    });
  }
  async snapshot(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    budget: ExportBudget,
  ) {
    await budget.collect(
      'privateDmBlocks',
      (after: string | undefined) =>
        tx.dmContactBlock.findMany({
          where: {
            ownerUserId: scope.actor.userId,
            ...(after ? { id: { gt: after } } : {}),
          },
          select: {
            id: true,
            sourceConversationId: true,
            active: true,
            revision: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: { id: 'asc' },
          take: 100,
        }),
      (row) => row.id,
    );
    await this.batches(tx, scope, async (actors) => {
      const admission = { Member: { actorId: { in: actors } } };
      await budget.collect(
        'messagePersonalProgress',
        (after: { memberId: string; generation: number } | undefined) =>
          tx.messageProgress.findMany({
            where: {
              admission,
              ...(after
                ? {
                    OR: [
                      { memberId: { gt: after.memberId } },
                      {
                        memberId: after.memberId,
                        generation: { gt: after.generation },
                      },
                    ],
                  }
                : {}),
            },
            orderBy: [{ memberId: 'asc' }, { generation: 'asc' }],
            take: 100,
          }),
        (row) => ({ memberId: row.memberId, generation: row.generation }),
      );
      await budget.collect(
        'messageNoticePreference',
        (after: { memberId: string; generation: number } | undefined) =>
          tx.messageNoticePreference.findMany({
            where: {
              admission,
              ...(after
                ? {
                    OR: [
                      { memberId: { gt: after.memberId } },
                      {
                        memberId: after.memberId,
                        generation: { gt: after.generation },
                      },
                    ],
                  }
                : {}),
            },
            orderBy: [{ memberId: 'asc' }, { generation: 'asc' }],
            take: 100,
          }),
        (row) => ({ memberId: row.memberId, generation: row.generation }),
      );
    });
  }
}
