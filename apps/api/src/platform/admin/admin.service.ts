import {
  Inject,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'node:http';
import { APP_CONFIG } from '../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../bootstrap/environment.js';
import { DatabaseService } from '../database/database.service.js';
import { createAdminAuth } from './create-admin-auth.js';
import { permits, type AdminPermission } from './admin-policy.js';

@Injectable()
export class AdminService {
  private provider?: ReturnType<typeof createAdminAuth>;
  get auth() {
    return (this.provider ??= createAdminAuth(
      this.config,
      this.database.client,
    ));
  }
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}
  async session(headers: IncomingHttpHeaders, mfa = true) {
    const session = await this.auth.api.getSession({
      headers: fromNodeHeaders(headers),
      query: { disableCookieCache: true, disableRefresh: true },
    });
    if (!session) throw new UnauthorizedException();
    const user = await this.database.client.adminUser.findUnique({
      where: { id: session.user.id },
    });
    if (!user?.active || (mfa && !user.twoFactorEnabled))
      throw new ForbiddenException();
    // Re-read after identity loading: revocation must not authorize a stale provider snapshot.
    const current = await this.database.client.adminSession.findUnique({
      where: { id: session.session.id },
    });
    if (!current || current.expiresAt <= new Date())
      throw new UnauthorizedException();
    // Enrollment sessions can never become privileged when another session enrolls MFA.
    if (
      mfa &&
      (!user.mfaEnrolledAt ||
        current.createdAt <= user.mfaEnrolledAt ||
        !current.mfaVerifiedAt ||
        current.mfaVerifiedAt <= user.mfaEnrolledAt)
    )
      throw new ForbiddenException();
    return {
      user,
      session: { ...session.session, mfaVerifiedAt: current.mfaVerifiedAt },
    };
  }
  async authorize(headers: IncomingHttpHeaders, permission: AdminPermission) {
    const actor = await this.session(headers);
    if (!permits(actor.user.role, permission)) throw new ForbiddenException();
    return actor;
  }
  requireRecent(actor: Awaited<ReturnType<AdminService['session']>>) {
    const verified = actor.session.mfaVerifiedAt;
    if (
      !verified ||
      Date.now() - verified.getTime() >= 300000 ||
      verified > new Date()
    )
      throw new ForbiddenException({ code: 'ADMIN_REAUTHENTICATION_REQUIRED' });
  }
  auditAttempt(action: string, requestId: string) {
    return this.database.client.adminAuditEvent.create({
      data: { action, requestId, outcome: 'ATTEMPTED' },
    });
  }
  auditOutcome(
    id: string,
    outcome: 'SUCCEEDED' | 'DENIED' | 'FAILED',
    actorAdminId: string | null = null,
  ) {
    return this.database.client.adminAuditEvent.update({
      where: { id },
      data: { outcome, actorAdminId },
    });
  }
  auditDenial(requestId: string) {
    return this.database.client.adminAuditEvent.create({
      data: { action: 'ADMIN_ACCESS_DENIED', requestId, outcome: 'DENIED' },
    });
  }
  completeEnrollment(userId: string) {
    return this.database.client.$transaction(async (tx) => {
      await tx.adminUser.update({
        where: { id: userId },
        data: { mfaEnrolledAt: new Date() },
      });
      await tx.adminSession.deleteMany({ where: { userId } });
    });
  }
  /** Called only after a successful provider second-factor response, never password sign-in. */
  async confirmMfa(token: string) {
    await this.database.client.adminSession.updateMany({
      where: { token },
      data: { mfaVerifiedAt: new Date() },
    });
  }
}
