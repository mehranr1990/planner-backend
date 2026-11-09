import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import {
  ExportBudget,
  PersonalData,
} from '../../../platform/lifecycle/personal-data.js';
import { MeetingKernel } from './meeting-kernel.js';
@Injectable()
export class MeetingData extends PersonalData {
  constructor(@Inject(MeetingKernel) private readonly op: MeetingKernel) {
    super();
  }
  private async actors(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    work: (ids: string[]) => Promise<void>,
  ) {
    let after: string | undefined;
    for (;;) {
      const ids = await this.op.authority.ownedActors(tx, scope, after);
      if (!ids.length) return;
      await work(ids);
      after = ids.at(-1);
    }
  }
  override suspend(tx: Prisma.TransactionClient, scope: AuthorizedSpace) {
    return this.actors(tx, scope, async (ids) => {
      await tx.announcementAcknowledgement.deleteMany({
        where: { actorId: { in: ids } },
      });
    });
  }
  erase(tx: Prisma.TransactionClient, scope: AuthorizedSpace) {
    return this.suspend(tx, scope);
  }
  snapshot(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    budget: ExportBudget,
  ) {
    return this.actors(tx, scope, async (ids) => {
      await budget.collect(
        'announcementAcknowledgements',
        (after: { versionId: string; accessId: string } | undefined) =>
          tx.announcementAcknowledgement.findMany({
            where: {
              actorId: { in: ids },
              ...(after
                ? {
                    OR: [
                      { versionId: { gt: after.versionId } },
                      {
                        versionId: after.versionId,
                        accessId: { gt: after.accessId },
                      },
                    ],
                  }
                : {}),
            },
            orderBy: [{ versionId: 'asc' }, { accessId: 'asc' }],
            take: 100,
          }),
        (row) => ({ versionId: row.versionId, accessId: row.accessId }),
      );
    });
  }
}
