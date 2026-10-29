import {
  Inject,
  Injectable,
  ForbiddenException,
  UnauthorizedException,
  HttpException,
} from '@nestjs/common';
import { isAPIError } from 'better-auth/api';
import { PinoLogger } from 'nestjs-pino';
import { fromNodeHeaders } from 'better-auth/node';
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
      (message) => mail.send(message),
      () => logger.warn({ provider: 'better-auth' }, 'Identity provider event'),
      admission,
    );
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
    try {
      return await this.auth.api.updateUser({
        headers: fromNodeHeaders(headers),
        body,
      });
    } catch (error) {
      if (isAPIError(error))
        throw new HttpException('Identity request failed', error.statusCode);
      throw error;
    }
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
  async revokeAllInside(tx: Prisma.TransactionClient, userId: string) {
    await tx.authSession.deleteMany({ where: { userId } });
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
