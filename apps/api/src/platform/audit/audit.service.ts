import { Inject, Injectable, Module } from '@nestjs/common';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';
import { DatabaseModule } from '../database/database.module.js';

const ActionSchema = z.enum([
  'AUTH_SIGN_UP',
  'AUTH_SIGN_IN',
  'AUTH_SIGN_OUT',
  'AUTH_VERIFY_EMAIL',
  'AUTH_VERIFICATION_REQUEST',
  'AUTH_RECOVERY_REQUEST',
  'AUTH_PASSWORD_RESET',
  'AUTH_PASSWORD_CHANGE',
  'AUTH_EMAIL_CHANGE',
  'AUTH_SESSION_LIST',
  'AUTH_SESSION_REVOKE',
  'ACCOUNT_PROFILE_UPDATE',
  'ACCOUNT_SETTINGS_UPDATE',
  'ACCESS_DENIED',
  'FILE_INITIATE',
  'FILE_COMPLETE',
  'FILE_DOWNLOAD',
  'FILE_DELETE',
  'FILE_CLEANUP',
  'FILE_ACCESS_DENIED',
  'TASK_RECURRENCE_CREATE',
  'TASK_RECURRENCE_EDIT',
  'TASK_RECURRENCE_CANCEL',
  'TASK_OCCURRENCE_SKIP',
  'TASK_OCCURRENCE_CANCEL',
  'ACCOUNT_PLANNING_AVAILABILITY_UPDATE',
  'PLANNING_DAY_CREATE',
  'PLANNING_SELECTION_UPDATE',
  'PLANNING_SELECTION_REMOVE',
  'PLANNING_SELECTION_MOVE',
  'PLANNING_DAY_REORDER',
  'PLANNING_WEEK_CREATE',
  'PLANNING_REVIEW_CREATE',
  'PLANNING_REVIEW_UPDATE',
  'PLANNING_REVIEW_DELETE',
  'PLANNING_ROLLOVER',
  'CALENDAR_EVENT_CHANGE',
  'TIME_BLOCK_CHANGE',
]);
const AuditSchema = z.strictObject({
  action: ActionSchema,
  outcome: z.enum(['ATTEMPTED', 'SUCCEEDED', 'DENIED', 'FAILED']),
  actorUserId: z.string().uuid().nullable().default(null),
  requestId: z.string().uuid(),
  correlationId: z.string().uuid(),
  resourceId: z.string().uuid().nullable().default(null),
  changedFields: z
    .array(
      z.enum([
        'name',
        'image',
        'locale',
        'timezone',
        'preferredCalendar',
        'firstDayOfWeek',
      ]),
    )
    .max(6)
    .default([]),
});
export type AuditInput = z.input<typeof AuditSchema>;
export type AuditAction = z.infer<typeof ActionSchema>;

export function writeAudit(
  tx: Pick<Prisma.TransactionClient, 'securityAuditEvent'>,
  input: AuditInput,
) {
  return tx.securityAuditEvent.create({ data: AuditSchema.parse(input) });
}

@Injectable()
export class AuditService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}
  record(input: AuditInput) {
    return writeAudit(this.database.client, input);
  }
  async outcome(
    id: string,
    outcome: 'SUCCEEDED' | 'DENIED' | 'FAILED',
    actorUserId: string | null = null,
  ): Promise<void> {
    await this.database.client.securityAuditEvent.update({
      where: { id },
      data: { outcome, actorUserId },
    });
  }
}

@Module({
  imports: [DatabaseModule],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
