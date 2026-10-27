import { Inject, Injectable } from '@nestjs/common';
import type { SettingsPatch } from '@mehran/api-contracts';
import { DatabaseService } from '../../../platform/database/database.service.js';
import type { SettingsPort } from '../application/settings.port.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { requireOneRevision } from '../../../bootstrap/concurrency.js';
import { appendOutbox } from '../../../platform/outbox/outbox.js';
import { writeAudit } from '../../../platform/audit/audit.service.js';

@Injectable()
export class SettingsRepository implements SettingsPort {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}
  forUser(userId: string) {
    return this.database.client.$transaction(async (tx) => {
      await tx.userSettings.createMany({
        data: [{ userId }],
        skipDuplicates: true,
      });
      return tx.userSettings.findUniqueOrThrow({ where: { userId } });
    });
  }
  update(
    scope: AuthorizedSpace,
    data: SettingsPatch,
    revision: number | undefined,
  ) {
    const userId = scope.actor.userId;
    return this.database.client.$transaction(async (tx) => {
      const before = await tx.userSettings.findUniqueOrThrow({
        where: { userId },
      });
      const result = await tx.userSettings.updateMany({
        where: { userId, revision: revision ?? before.revision },
        data: { ...data, revision: { increment: 1 } },
      });
      requireOneRevision(result.count);
      if (data.timezone !== undefined && data.timezone !== before.timezone)
        await appendOutbox(tx, scope, {
          type: 'account.timezone_changed',
          version: 1,
          aggregateId: userId,
          payload: {},
        });
      await writeAudit(tx, {
        action: 'ACCOUNT_SETTINGS_UPDATE',
        outcome: 'SUCCEEDED',
        actorUserId: userId,
        requestId: scope.actor.requestId,
        correlationId: scope.actor.correlationId,
        changedFields: Object.keys(data) as Array<keyof SettingsPatch>,
      });
      return tx.userSettings.findUniqueOrThrow({ where: { userId } });
    });
  }
}
