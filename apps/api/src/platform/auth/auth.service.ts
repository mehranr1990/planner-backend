import type { EmailMetadata } from './email-evidence.js';
import {
  Inject,
  Injectable,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { fromNodeHeaders } from 'better-auth/node';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { IncomingHttpHeaders } from 'node:http';
import type { Prisma } from '../../generated/prisma/client.js';
import { APP_CONFIG } from '../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../bootstrap/environment.js';
import { DatabaseService } from '../database/database.service.js';
import { IdentityMailService } from './mail.service.js';
import {
  INITIAL_IDENTITY_RELATIONS,
  identityClient,
} from './identity-relations.js';
import type { InitialIdentityRelations } from './identity-relations.js';
import { createIdentityAuth } from './create-auth.js';
import { IDENTITY_ADMISSION } from './admission.js';
import type { IdentityAdmission } from './admission.js';

@Injectable()
export class AuthService {
  private readonly recoveryDeliveries = new AsyncLocalStorage<{
    userId: string;
    email: string;
    delivery?: Promise<void>;
    metadata?: EmailMetadata;
  }>();
  private readonly verificationDeliveries = new AsyncLocalStorage<{
    userId: string;
    email: string;
    delivery?: Promise<void>;
    metadata?: EmailMetadata;
  }>();
  readonly auth: ReturnType<typeof createIdentityAuth>;
  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(IdentityMailService) mail: IdentityMailService,
    @Inject(INITIAL_IDENTITY_RELATIONS) relations: InitialIdentityRelations,
    @Inject(PinoLogger) logger: PinoLogger,
    @Inject(IDENTITY_ADMISSION) private readonly admission: IdentityAdmission,
  ) {
    this.auth = createIdentityAuth(
      config,
      identityClient(database.client, relations),
      (message) => {
        const context = this.verificationDeliveries.getStore();
        if (!context) return mail.send(message);
        if (
          context.email !== message.to ||
          message.kind !== 'verify-email' ||
          message.metadata?.userId !== context.userId
        )
          throw new ForbiddenException();
        context.delivery = mail.send({
          ...message,
          metadata: context.metadata ?? {
            category: 'REGISTRATION_VERIFICATION',
            userId: context.userId,
          },
        });
        return context.delivery;
      },
      () => logger.warn({ provider: 'better-auth' }, 'Identity provider event'),
      admission,
      async (userId, message) => {
        const context = this.recoveryDeliveries.getStore();
        if (context) {
          if (context.userId !== userId || context.email !== message.to)
            throw new ForbiddenException();
          context.delivery = (async () => {
            await admission(userId);
            await mail.send({
              ...message,
              metadata: context.metadata ?? {
                category: 'PASSWORD_RECOVERY',
                userId,
              },
            });
          })();
          return context.delivery;
        }
        return mail.send(message);
      },
    );
  }
  /** Observe the actual SMTP promise; the provider intentionally hides delivery failures from public recovery. */
  async dispatchRecovery(userId: string, metadata?: EmailMetadata) {
    await this.admission(userId);
    const user = await this.database.client.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, emailVerified: true },
    });
    if (!user.emailVerified) throw new ForbiddenException();
    const context: {
      userId: string;
      email: string;
      delivery?: Promise<void>;
      metadata?: EmailMetadata;
    } = { userId, email: user.email, ...(metadata ? { metadata } : {}) };
    await this.recoveryDeliveries.run(context, async () => {
      await this.auth.api.requestPasswordReset({ body: { email: user.email } });
      if (!context.delivery)
        throw new Error('Recovery delivery was not dispatched');
      await context.delivery;
    });
  }
  async associateRegistrationMail(userId: string) {
    await this.database.client.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { email: string; createdAt: Date }[]
      >`SELECT email,"createdAt" FROM "User" WHERE id=${userId}::uuid FOR KEY SHARE`;
      const user = rows[0];
      // Anti-enumeration sign-up responses may contain a synthetic provider ID.
      if (!user) return;
      await tx.systemEmailObservation.updateMany({
        where: {
          userId: null,
          recipient: user.email,
          category: 'REGISTRATION_VERIFICATION',
          sourceKind: 'DIRECT',
          createdAt: { gte: user.createdAt },
        },
        data: { userId },
      });
    });
  }
  async dispatchVerification(userId: string, metadata?: EmailMetadata) {
    await this.admission(userId);
    const user = await this.database.client.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, emailVerified: true },
    });
    if (user.emailVerified) throw new ForbiddenException();
    const context: {
      userId: string;
      email: string;
      delivery?: Promise<void>;
      metadata?: EmailMetadata;
    } = { userId, email: user.email, ...(metadata ? { metadata } : {}) };
    await this.verificationDeliveries.run(context, async () => {
      await this.auth.api.sendVerificationEmail({
        body: { email: user.email },
      });
      if (!context.delivery)
        throw new Error('Verification delivery was not dispatched');
      await context.delivery;
    });
  }
  async session(
    headers: IncomingHttpHeaders,
    setCookie?: (value: string) => void,
  ) {
    const result = await this.auth.api.getSession({
      headers: fromNodeHeaders(headers),
      query: { disableCookieCache: true },
      returnHeaders: true,
    });
    for (const cookie of result.headers.getSetCookie()) setCookie?.(cookie);
    if (result.response) await this.admission(result.response.user.id);
    return result.response;
  }
  async auditActor(headers: IncomingHttpHeaders): Promise<string | null> {
    if (!headers.cookie) return null;
    const session = await this.auth.api.getSession({
      headers: fromNodeHeaders(headers),
      query: { disableCookieCache: true, disableRefresh: true },
    });
    return session?.user.id ?? null;
  }
  async updateProfile(
    headers: IncomingHttpHeaders,
    body: { name?: string; image?: string | null },
  ) {
    const session = await this.session(headers);
    if (!session) throw new UnauthorizedException();
    return this.database.client.$transaction(async (tx) => {
      const personal = await tx.space.findFirstOrThrow({
        where: { kind: 'PERSONAL', ownerUserId: session.user.id },
        select: { id: true },
      });
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'personal-access:' + personal.id},0))::text`;
      await this.admission(session.user.id);
      const current = await tx.authSession.findUnique({
        where: { id: session.session.id },
      });
      if (!current || current.expiresAt <= new Date())
        throw new UnauthorizedException();
      await tx.user.update({ where: { id: session.user.id }, data: body });
      return { status: true };
    });
  }
  async requireFreshSession(headers: IncomingHttpHeaders): Promise<void> {
    const session = await this.session(headers);
    if (!session) throw new UnauthorizedException();
    const freshAge = (await this.auth.$context).sessionConfig.freshAge;
    if (
      !session.user.emailVerified ||
      freshAge <= 0 ||
      Date.now() - session.session.createdAt.getTime() >= freshAge * 1000
    )
      throw new ForbiddenException();
  }
  async verifyPassword(userId: string, password: string) {
    const ctx = await this.auth.$context;
    const accounts = await ctx.internalAdapter.findAccounts(userId);
    const credential = accounts.find((a) => a.providerId === 'credential');
    if (
      !credential?.password ||
      !(await ctx.password.verify({ hash: credential.password, password }))
    )
      throw new ForbiddenException({ code: 'REAUTHENTICATION_FAILED' });
  }
  async revokeAll(userId: string) {
    await (await this.auth.$context).internalAdapter.deleteUserSessions(userId);
  }
  /** Provider verification under predeclared identity/credential locks; no preauthorization token. */
  async verifyPasswordInside(
    tx: Prisma.TransactionClient,
    userId: string,
    password: string,
  ) {
    const ctx = await this.auth.$context;
    const credential = await tx.authAccount.findFirst({
      where: { userId, providerId: 'credential' },
      select: { password: true },
    });
    if (
      !credential?.password ||
      !(await ctx.password.verify({ hash: credential.password, password }))
    )
      throw new ForbiddenException({ code: 'REAUTHENTICATION_FAILED' });
  }
  async revokeAllInside(tx: Prisma.TransactionClient, userId: string) {
    await tx.authSession.deleteMany({ where: { userId } });
  }
  async revokeSelectedInside(
    tx: Prisma.TransactionClient,
    userId: string,
    sessionIds: string[],
  ) {
    await tx.authSession.deleteMany({
      where: { userId, id: { in: sessionIds } },
    });
  }
  async sessionMetadata(userId: string) {
    const rows = await this.database.client.authSession.findMany({
      where: { userId, expiresAt: { gt: new Date() } },
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
  async revokeOtherSessionsInside(
    tx: Prisma.TransactionClient,
    userId: string,
    sessionId: string | undefined,
  ) {
    await tx.authSession.deleteMany({
      where: { userId, ...(sessionId ? { id: { not: sessionId } } : {}) },
    });
  }
  /** Identity-owner erasure in the caller's transaction; provider has no secondary storage. */
  async eraseIdentityInside(tx: Prisma.TransactionClient, userId: string) {
    await tx.authVerification.deleteMany({ where: { value: userId } });
    await tx.authSession.deleteMany({ where: { userId } });
    await tx.authAccount.deleteMany({ where: { userId } });
    await tx.user.deleteMany({ where: { id: userId } });
  }
  async eraseIdentity(userId: string) {
    await this.database.client.authVerification.deleteMany({
      where: { value: userId },
    });
    await (await this.auth.$context).internalAdapter.deleteUser(userId);
  }
  async profileSnapshot(tx: Prisma.TransactionClient, userId: string) {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) throw new ForbiddenException();
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      image: user.image ?? null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }
  identityIds(tx: Prisma.TransactionClient) {
    return tx.user.findMany({ select: { id: true }, take: 100001 });
  }
}
