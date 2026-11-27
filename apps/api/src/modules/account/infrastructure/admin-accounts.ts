import type { AdminUserQuerySchema } from '@mehran/api-contracts';
import type { z } from 'zod';
import type { EmailMetadata } from '../../../platform/auth/email-evidence.js';
import {
  Inject,
  Injectable,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import { AdminIdentity } from '../../../platform/auth/admin-identity.js';
import { AuthService } from '../../../platform/auth/auth.service.js';
import { effectiveSuspension } from '../../../platform/admin/management-policy.js';

export type AccountChange = {
  sessionIds?: string[] | undefined;
  revision: number;
  reason: string;
  internalNote?: string | undefined;
  expiresAt?: string | undefined;
  name?: string | undefined;
  email?: string | undefined;
};
@Injectable()
export class AdminAccounts {
  async sessions(id: string) {
    await this.identity.detail(this.db.client, id);
    return this.auth.sessionMetadata(id);
  }
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AdminIdentity) private readonly identity: AdminIdentity,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}
  async list(actorId: string, q: z.infer<typeof AdminUserQuerySchema>) {
    const page = await this.identity.list(actorId, q);
    return {
      ...page,
      items: await Promise.all(page.items.map((row) => this.detail(row.id))),
    };
  }
  detail(id: string, tx: Prisma.TransactionClient = this.db.client) {
    return Promise.all([
      this.identity.detail(tx, id),
      tx.userSettings.findUniqueOrThrow({
        where: { userId: id },
        select: {
          firstRecordedLoginAt: true,
          lastRecordedLoginAt: true,
          signInHistoryComplete: true,
          signInEvidence: true,
          emailVerifiedAt: true,
          adminRevision: true,
          suspendedAt: true,
          suspensionExpiresAt: true,
          suspensionReason: true,
        },
      }),
      tx.authSession.count({
        where: { userId: id, expiresAt: { gt: new Date() } },
      }),
    ]).then(([user, state, activeSessions]) => ({
      ...user,
      registration: {
        registeredAt: user.createdAt.toISOString(),
        verificationStatus: user.emailVerified ? 'VERIFIED' : 'UNVERIFIED',
        emailVerifiedAt: state.emailVerifiedAt?.toISOString() ?? null,
        verificationDateEvidence: !user.emailVerified
          ? 'NOT_VERIFIED'
          : state.emailVerifiedAt
            ? 'RECORDED'
            : 'UNKNOWN',
        loginStatus: state.lastRecordedLoginAt
          ? 'RECORDED_SUCCESS'
          : 'NO_RECORDED_SUCCESS',
        firstSuccessfulLoginAt: state.signInHistoryComplete
          ? (state.firstRecordedLoginAt?.toISOString() ?? null)
          : null,
        firstLoginEvidence: state.signInHistoryComplete
          ? 'COMPLETE_HISTORY'
          : 'UNKNOWN',
        firstRecordedSuccessfulLoginAt:
          state.firstRecordedLoginAt?.toISOString() ?? null,
        lastSuccessfulLoginAt: state.lastRecordedLoginAt?.toISOString() ?? null,
        loginHistory: state.signInHistoryComplete
          ? 'COMPLETE'
          : state.lastRecordedLoginAt
            ? 'PARTIAL'
            : 'UNKNOWN',
        loginEvidence: state.signInEvidence,
      },
      revision: state.adminRevision,
      status: effectiveSuspension(state)
        ? 'SUSPENDED'
        : user.emailVerified
          ? 'ACTIVE'
          : 'INACTIVE',
      suspension: state.suspendedAt
        ? {
            publicReason: state.suspensionReason,
            expiresAt: state.suspensionExpiresAt,
            effective: effectiveSuspension(state),
          }
        : null,
      security: {
        activeSessions,
        mfa: {
          available: false,
          reason: 'Ordinary identity provider has no configured MFA',
        },
      },
      usage: {
        available: false,
        reason: 'No privacy-safe account usage projection',
      },
    }));
  }
  async change(
    tx: Prisma.TransactionClient,
    id: string,
    operation: string,
    input: AccountChange,
  ) {
    const personal = await tx.space.findFirst({
      where: { ownerUserId: id, kind: 'PERSONAL' },
      select: { id: true },
    });
    if (!personal) throw new ForbiddenException();
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'personal-access:' + personal.id},0))::text`;
    await this.identity.lock(tx, id);
    const state = await tx.userSettings.findUniqueOrThrow({
      where: { userId: id },
    });
    if (state.adminRevision !== input.revision)
      throw new ConflictException({ code: 'STALE_REVISION' });
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && expiresAt <= new Date())
      throw new BadRequestException({ code: 'EXPIRY_IN_PAST' });
    if (operation === 'suspend' || operation === 'revoke-sessions')
      await this.auth.revokeAllInside(tx, id);
    if (operation === 'revoke-selected-sessions')
      await this.auth.revokeSelectedInside(tx, id, input.sessionIds ?? []);
    if (operation === 'update' || operation === 'verify-email')
      await this.identity.update(tx, id, operation, input);
    if (operation === 'verify-email') await this.auth.revokeAllInside(tx, id);
    if (operation === 'resend-verification') {
      const user = await this.identity.detail(tx, id);
      if (user.emailVerified || effectiveSuspension(state))
        throw new ForbiddenException();
    }
    if (operation === 'resend-verification') {
      const queued = await tx.adminDelivery.count({
        where: {
          targetUserId: id,
          kind: 'EMAIL_VERIFICATION',
          createdAt: { gte: new Date(Date.now() - 60000) },
        },
      });
      if (queued >= 3)
        throw new ForbiddenException({ code: 'VERIFICATION_THROTTLED' });
    }
    if (operation === 'recovery') {
      const user = await this.identity.detail(tx, id);
      if (
        (operation === 'recovery' && !user.emailVerified) ||
        effectiveSuspension(state)
      )
        throw new ForbiddenException();
      const recent = await tx.adminAuditEvent.count({
        where: {
          targetUserId: id,
          action: {
            in:
              operation === 'recovery'
                ? [
                    'POST users/:id/recovery',
                    'POST security/users/:id/recovery',
                    'POST system-emails/:id/retry',
                  ]
                : [
                    'POST users/:id/resend-verification',
                    'POST system-emails/:id/retry',
                  ],
          },
          createdAt: { gte: new Date(Date.now() - 60000) },
        },
      });
      if (recent > 3)
        throw new ForbiddenException({ code: 'RECOVERY_THROTTLED' });
    }
    await tx.userSettings.update({
      where: { userId: id },
      data: {
        adminRevision: { increment: 1 },
        ...(operation === 'suspend'
          ? {
              suspendedAt: new Date(),
              suspensionExpiresAt: expiresAt,
              suspensionReason: input.reason,
            }
          : operation === 'reactivate'
            ? {
                suspendedAt: null,
                suspensionExpiresAt: null,
                suspensionReason: null,
              }
            : {}),
      },
    });
    return this.detail(id, tx);
  }
  async recovery(id: string, metadata?: EmailMetadata) {
    await this.auth.dispatchRecovery(id, metadata);
  }
  async verification(id: string, metadata?: EmailMetadata) {
    await this.auth.dispatchVerification(id, metadata);
  }
  async metrics(from: Date, until: Date) {
    const now = new Date();
    const suspended = {
      suspendedAt: { not: null },
      OR: [{ suspensionExpiresAt: null }, { suspensionExpiresAt: { gt: now } }],
    };
    const [identity, suspendedUsers, active, inactive] = await Promise.all([
      this.identity.metrics(from, until),
      this.db.client.userSettings.count({ where: suspended }),
      this.db.client.user.count({
        where: { emailVerified: true, NOT: { settings: suspended } },
      }),
      this.db.client.user.count({
        where: { emailVerified: false, NOT: { settings: suspended } },
      }),
    ]);
    return { ...identity, suspended: suspendedUsers, active, inactive };
  }
}
