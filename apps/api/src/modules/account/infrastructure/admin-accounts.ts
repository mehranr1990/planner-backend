import {
  Inject,
  Injectable,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import {
  AdminIdentity,
  type AdminPage,
} from '../../../platform/auth/admin-identity.js';
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
  async list(actorId: string, q: AdminPage) {
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
    if (operation === 'recovery') {
      const user = await this.identity.detail(tx, id);
      if (!user.emailVerified || effectiveSuspension(state))
        throw new ForbiddenException();
      const recent = await tx.adminAuditEvent.count({
        where: {
          targetUserId: id,
          action: {
            in: ['POST users/:id/recovery', 'POST security/users/:id/recovery'],
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
  async recovery(id: string) {
    await this.auth.dispatchRecovery(id);
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
