import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import { Prisma } from '../../generated/prisma/client.js';
import { DatabaseService } from '../../platform/database/database.service.js';
import { AdminCommand } from '../../platform/admin/admin-command.js';
import {
  cursorPage,
  cursorPosition,
} from '../../platform/database/cursor-pagination.js';
import { effectiveSuspension } from '../../platform/admin/management-policy.js';
import {
  directEmailRows,
  sourceEmailRows,
} from '../../platform/auth/email-query.js';
import type { EmailQuery, EmailRow } from '../../platform/auth/email-query.js';
import { operationalEmailRows } from '../../platform/operations/email-diagnostics.js';
import { invitationEmailRows } from '../spaces/public/email-diagnostics.js';
import { conversationEmailRows } from '../messaging/public/email-diagnostics.js';
import { meetingEmailRows } from '../meetings/public/email-diagnostics.js';
import { notificationEmailRows } from '../notifications/public/email-diagnostics.js';
import { engagementEmailRows } from '../admin-engagement/public/email-diagnostics.js';
import { AdminAccounts } from '../account/public/index.js';

@Injectable()
export class EmailDiagnosticsService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AdminAccounts) private readonly accounts: AdminAccounts,
  ) {}
  private adminRows(tx: Prisma.TransactionClient, q: EmailQuery) {
    return sourceEmailRows(
      tx,
      Prisma.sql`SELECT 'ADMIN_DELIVERY'::text "sourceKind",d.id "sourceId",
      CASE WHEN d.kind='PASSWORD_RECOVERY' THEN 'PASSWORD_RECOVERY' WHEN d.kind='EMAIL_VERIFICATION' THEN 'REGISTRATION_VERIFICATION' ELSE 'SYSTEM_NOTICE' END category,
      d."createdAt",d."targetUserId" "userId",COALESCE(d."recipientEmail",d.payload->>'expectedEmail',u.email) "plannedRecipient",
      'USER'::text "resourceKind",d."targetUserId" "resourceId",d.state "rawState",d.attempts,
      CASE WHEN d.state='PENDING' THEN d."nextAt" END "nextAt",d."leaseUntil"
      FROM "AdminDelivery" d LEFT JOIN "User" u ON u.id=d."targetUserId"`,
      q,
    );
  }
  private async rows(q: EmailQuery) {
    // Each owning facade applies identical filters BEFORE its bounded page.
    const owners = [
      directEmailRows,
      invitationEmailRows,
      conversationEmailRows,
      meetingEmailRows,
      notificationEmailRows,
      engagementEmailRows,
      operationalEmailRows,
      this.adminRows.bind(this),
    ];
    const rows = (
      await Promise.all(owners.map((owner) => owner(this.db.client, q)))
    ).flat();
    return rows.sort(
      (a, b) =>
        a.pageAt.getTime() - b.pageAt.getTime() ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  }
  private async view(row: EmailRow) {
    const retryActions: z.infer<typeof c.EmailRetryActionSchema>[] = [];
    if (row.userId && !['QUEUED', 'PROCESSING'].includes(row.status)) {
      const state = await this.db.client.userSettings.findUnique({
        where: { userId: row.userId },
      });
      const user = await this.db.client.user.findUnique({
        where: { id: row.userId },
        select: { email: true, emailVerified: true },
      });
      if (
        state &&
        user &&
        !effectiveSuspension(state) &&
        (!row.recipient || row.recipient === user.email)
      ) {
        if (row.category === 'REGISTRATION_VERIFICATION' && !user.emailVerified)
          retryActions.push('RESEND_VERIFICATION');
        if (row.category === 'PASSWORD_RECOVERY' && user.emailVerified)
          retryActions.push('RECOVERY');
        if (
          row.sourceKind === 'ADMIN_DELIVERY' &&
          row.rawState === 'FAILED' &&
          row.category === 'SYSTEM_NOTICE' &&
          row.status === 'FAILED'
        ) {
          const delivery = await this.db.client.adminDelivery.findUnique({
            where: { id: row.sourceId },
            select: { kind: true },
          });
          if (
            delivery &&
            ['ACCOUNT_CHANGED', 'WORKSPACE_CHANGED'].includes(delivery.kind)
          )
            retryActions.push('RETRY_NOTICE');
        }
      }
    }
    return c.AdminEmailLogSchema.parse({
      id: row.id,
      sourceKind: row.sourceKind,
      sourceId: row.sourceId,
      category: row.category,
      recipient: row.recipient,
      recipientEvidence: row.observedRecipient
        ? 'OBSERVED'
        : row.recipient
          ? 'PLANNED'
          : 'UNKNOWN',
      userId: row.userId,
      resourceKind: row.resourceKind,
      resourceId: row.resourceId,
      createdAt: row.createdAt?.toISOString() ?? null,
      creationEvidence: row.createdAt ? 'RECORDED' : 'UNKNOWN',
      status: row.status,
      sourceState: row.rawState,
      attemptCount: row.attempts,
      observedAttemptCount: row.observedCount,
      firstRecordedAttemptAt: row.firstAt?.toISOString() ?? null,
      lastRecordedAttemptAt: row.lastAt?.toISOString() ?? null,
      lastRecordedCompletionAt: row.completedAt?.toISOString() ?? null,
      nextAttemptAt: row.nextAt?.toISOString() ?? null,
      failureCode: row.code,
      providerMessageReference: row.providerReference,
      deliveryEvidence:
        row.observedCount > 0 ? 'OBSERVED_ATTEMPT' : 'SOURCE_STATE_ONLY',
      inboxDelivery: 'UNKNOWN',
      retryActions,
    });
  }
  async list(actorId: string, q: z.infer<typeof c.AdminEmailQuerySchema>) {
    if (q.from && q.until && new Date(q.from) >= new Date(q.until))
      throw new BadRequestException();
    const scope = {
      actor: { userId: actorId, requestId: actorId, correlationId: actorId },
      spaceId: actorId,
    };
    const filter = createHash('sha256')
      .update(JSON.stringify({ ...q, cursor: undefined, limit: undefined }))
      .digest('hex');
    const position = cursorPosition(scope, filter, q.cursor);
    const rows = await this.rows({ ...q, position });
    const page = cursorPage(
      scope,
      filter,
      q.limit,
      rows.map((r) => ({ id: r.id, createdAt: r.pageAt, row: r })),
    );
    return c.AdminEmailPageSchema.parse({
      nextCursor: page.nextCursor,
      items: await Promise.all(page.items.map((r) => this.view(r.row))),
    });
  }
  async detail(id: string) {
    const rows = await this.rows({ id, limit: 1 });
    if (!rows[0]) throw new NotFoundException();
    return this.view(rows[0]);
  }
  async resendVerification(
    command: AdminCommand,
    id: string,
    input: z.infer<typeof c.AdminReasonSchema>,
  ) {
    command.require('admin.users.verification.resend');
    return this.queueCredential(command, id, input, 'RESEND_VERIFICATION');
  }
  private queueCredential(
    command: AdminCommand,
    id: string,
    input: { reason: string; revision: number },
    action: 'RESEND_VERIFICATION' | 'RECOVERY',
  ) {
    return this.db.client.$transaction((tx) =>
      command.execute(tx, () =>
        this.queueCredentialInside(tx, command, id, input, action),
      ),
    );
  }
  private async queueCredentialInside(
    tx: Prisma.TransactionClient,
    command: AdminCommand,
    id: string,
    input: { reason: string; revision: number },
    action: 'RESEND_VERIFICATION' | 'RECOVERY',
  ) {
    await tx.adminAuditEvent.update({
      where: { id: command.auditId },
      data: { targetUserId: id, targetSpaceId: null },
    });
    const permission =
      action === 'RECOVERY'
        ? 'admin.users.recovery_initiate'
        : 'admin.users.verification.resend';
    await AdminCommand.requireInitiator(tx, command.adminId, permission);
    const before = await this.accounts.detail(id, tx);
    const after = await this.accounts.change(
      tx,
      id,
      action === 'RECOVERY' ? 'recovery' : 'resend-verification',
      input,
    );
    const delivery = await tx.adminDelivery.create({
      data: {
        auditId: command.auditId,
        targetUserId: id,
        kind:
          action === 'RECOVERY' ? 'PASSWORD_RECOVERY' : 'EMAIL_VERIFICATION',
        payload: { expectedEmail: before.email },
      },
    });
    await command.recordChange(
      tx,
      { revision: before.revision },
      { revision: after.revision, deliveryId: delivery.id },
    );
    return { action, queuedDeliveryId: delivery.id };
  }
  async retry(
    command: AdminCommand,
    id: string,
    input: z.infer<typeof c.AdminEmailRetrySchema>,
  ) {
    command.require('admin.email.retry');
    return this.db.client.$transaction((tx) =>
      command.execute(tx, async () => {
        const row = await this.detail(id);
        if (!row.retryActions.includes(input.action) || !row.userId)
          throw new ConflictException();
        if (input.action !== 'RETRY_NOTICE')
          return this.queueCredentialInside(
            tx,
            command,
            row.userId,
            input,
            input.action,
          );
        await tx.$queryRaw`SELECT id FROM "AdminDelivery" WHERE id=${row.sourceId}::uuid FOR UPDATE`;
        const current = await tx.adminDelivery.findUnique({
          where: { id: row.sourceId },
        });
        if (
          !current ||
          current.state !== 'FAILED' ||
          current.attempts !== input.attempts ||
          !['ACCOUNT_CHANGED', 'WORKSPACE_CHANGED'].includes(current.kind)
        )
          throw new ConflictException();
        const user = await this.accounts.detail(row.userId!, tx);
        if (!user.emailVerified || user.status === 'SUSPENDED')
          throw new ForbiddenException();
        await tx.adminDelivery.update({
          where: { id: current.id },
          data: { state: 'CANCELED', leaseUntil: null },
        });
        const replacement = await tx.adminDelivery.create({
          data: {
            auditId: command.auditId,
            targetUserId: row.userId!,
            kind: current.kind,
            payload: {
              ...(current.payload as Prisma.InputJsonObject),
              expectedEmail: user.email,
              retryOf: current.id,
            },
          },
        });
        await command.recordChange(
          tx,
          { sourceId: current.id, state: 'FAILED', attempts: current.attempts },
          { sourceId: replacement.id, state: 'PENDING' },
        );
        return { action: input.action, queuedDeliveryId: replacement.id };
      }),
    );
  }
}
