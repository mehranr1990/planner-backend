import {
  Inject,
  Injectable,
  ForbiddenException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  AdminCriticalRequestSchema,
  AdminSecurityPolicySchema,
} from '@mehran/api-contracts';
import { AdminCommand } from './admin-command.js';
import { DatabaseService } from '../database/database.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  SECURITY_POLICY_ID,
  defaultAdminSecurityPolicy,
  approvalState,
} from './security-policy.js';

@Injectable()
export class AdminSecurityService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}
  async policy() {
    const row = await this.db.client.adminSecurityPolicy.findUnique({
      where: { id: SECURITY_POLICY_ID },
    });
    return {
      revision: row?.revision ?? 1,
      policy: AdminSecurityPolicySchema.parse(
        row?.policy ?? defaultAdminSecurityPolicy,
      ),
    };
  }
  private view(row: {
    id: string;
    input: unknown;
    action: string;
    state: string;
    requesterAdminId: string;
    approverAdminId: string | null;
    expiresAt: Date;
    createdAt: Date;
    completedAt: Date | null;
  }) {
    return {
      request: AdminCriticalRequestSchema.parse(row.input),
      id: row.id,
      action: row.action,
      state: approvalState(row),
      requesterAdminId: row.requesterAdminId,
      approverAdminId: row.approverAdminId,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    };
  }
  async approval(id: string, adminId: string) {
    const row = await this.db.client.adminSecurityApproval.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException();
    if (row.requesterAdminId !== adminId)
      await AdminCommand.requireInitiator(
        this.db.client,
        adminId,
        'admin.security.critical.approve',
      );
    return this.view(row);
  }
  async sessions(id: string) {
    const rows = await this.db.client.adminSession.findMany({
      where: { userId: id, expiresAt: { gt: new Date() } },
      select: { id: true, createdAt: true, expiresAt: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 101,
    });
    return {
      items: rows.slice(0, 100).map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
      })),
      truncated: rows.length > 100,
    };
  }
  async mutate(
    command: AdminCommand,
    operation: string,
    id: string | undefined,
    body: unknown,
  ) {
    command.require(
      operation === 'revoke'
        ? 'admin.security.sessions.revoke'
        : operation === 'block-login'
          ? 'admin.security.login.restrict'
          : operation === 'approve' || operation === 'reject'
            ? 'admin.security.critical.approve'
            : 'admin.security.critical.request',
    );
    return this.db.client.$transaction(async (tx) =>
      command.execute(tx, async () => {
        if (operation === 'request') {
          const input = AdminCriticalRequestSchema.parse(body);
          let targetEnrollmentAt: Date | null = null;
          if (input.action === 'MFA_RECOVERY') {
            if (input.targetAdminId === command.adminId)
              throw new ForbiddenException();
            const target = await tx.adminUser.findUnique({
              where: { id: input.targetAdminId },
            });
            if (!target?.active || !target.twoFactorEnabled)
              throw new ConflictException({ code: 'MFA_RECOVERY_INELIGIBLE' });
            targetEnrollmentAt = target.mfaEnrolledAt;
          }
          const now = (
            await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() now`
          )[0]!.now;
          const row = await tx.adminSecurityApproval.create({
            data: {
              action: input.action,
              targetEnrollmentAt,
              requesterAdminId: command.adminId,
              targetAdminId:
                input.action === 'MFA_RECOVERY' ? input.targetAdminId : null,
              input: JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue,
              reason: input.reason,
              createdAt: now,
              expiresAt: new Date(+now + 1800000),
            },
          });
          return this.view(row);
        }
        if (operation === 'revoke') {
          const input = body as { sessionIds?: string[] };
          const deleted = await tx.adminSession.deleteMany({
            where: {
              userId: id!,
              ...(input.sessionIds ? { id: { in: input.sessionIds } } : {}),
            },
          });
          return { revoked: deleted.count };
        }
        if (operation === 'block-login') {
          const input = body as { blockedUntil: string | null };
          if (id === command.adminId) throw new ForbiddenException();
          const until = input.blockedUntil
            ? new Date(input.blockedUntil)
            : null;
          if (until && +until <= Date.now())
            throw new ConflictException({ code: 'EXPIRY_IN_PAST' });
          await tx.adminUser.update({
            where: { id: id! },
            data: { signInBlockedUntil: until },
          });
          if (until)
            await tx.adminSession.deleteMany({ where: { userId: id! } });
          return { id: id!, blockedUntil: until?.toISOString() ?? null };
        }
        await tx.$queryRaw`SELECT id FROM "AdminSecurityApproval" WHERE id=${id!}::uuid FOR UPDATE`;
        const row = await tx.adminSecurityApproval.findUnique({
          where: { id: id! },
        });
        if (!row) throw new NotFoundException();
        if (approvalState(row) === 'EXPIRED')
          throw new ConflictException({ code: 'APPROVAL_EXPIRED' });
        if (operation === 'approve' || operation === 'reject') {
          if (
            row.state !== 'PENDING' ||
            row.requesterAdminId === command.adminId ||
            row.targetAdminId === command.adminId
          )
            throw new ForbiddenException();
          await AdminCommand.requireInitiator(
            tx,
            row.requesterAdminId,
            'admin.security.critical.request',
          );
          const next = await tx.adminSecurityApproval.update({
            where: { id: row.id },
            data: {
              state: operation === 'approve' ? 'APPROVED' : 'REJECTED',
              approverAdminId: command.adminId,
              approvalReason: (body as { reason: string }).reason,
              ...(operation === 'reject' ? { completedAt: new Date() } : {}),
            },
          });
          return this.view(next);
        }
        if (
          operation !== 'execute' ||
          row.requesterAdminId !== command.adminId ||
          row.state !== 'APPROVED' ||
          !row.approverAdminId
        )
          throw new ForbiddenException();
        // Revalidate both operators at execution; a past approval is not permanent authority.
        await AdminCommand.requireInitiator(
          tx,
          row.approverAdminId,
          'admin.security.critical.approve',
        );
        const input = AdminCriticalRequestSchema.parse(row.input);
        if (input.action === 'MFA_RECOVERY') {
          const rows = await tx.$queryRaw<
            { id: string }[]
          >`SELECT id FROM "AdminUser" WHERE id=${input.targetAdminId}::uuid AND active AND "twoFactorEnabled" AND "mfaEnrolledAt" IS NOT DISTINCT FROM ${row.targetEnrollmentAt}::timestamptz FOR UPDATE`;
          if (!rows.length)
            throw new ConflictException({ code: 'MFA_RECOVERY_INELIGIBLE' });
          await tx.adminSession.deleteMany({
            where: { userId: input.targetAdminId },
          });
          await tx.adminTwoFactor.deleteMany({
            where: { userId: input.targetAdminId },
          });
          await tx.adminUser.update({
            where: { id: input.targetAdminId },
            data: {
              twoFactorEnabled: false,
              mfaEnrolledAt: null,
            },
          });
          // Password authentication can now enroll a new factor, but grants no privileged session.
        } else if (input.action === 'SECURITY_POLICY') {
          const changed = await tx.adminSecurityPolicy.updateMany({
            where: { id: SECURITY_POLICY_ID, revision: input.revision },
            data: {
              policy: input.policy,
              revision: { increment: 1 },
              updatedAt: new Date(),
            },
          });
          if (changed.count !== 1)
            throw new ConflictException({ code: 'STALE_REVISION' });
        } else {
          throw new ConflictException({
            code: 'EXECUTE_APPROVAL_AT_CONFIGURATION_BOUNDARY',
          });
        }
        return this.view(
          await tx.adminSecurityApproval.update({
            where: { id: row.id },
            data: { state: 'EXECUTED', completedAt: new Date() },
          }),
        );
      }),
    );
  }
}
