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

@Injectable()
export class AuthService {
  readonly auth: ReturnType<typeof createIdentityAuth>;
  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(DatabaseService) database: DatabaseService,
    @Inject(IdentityMailService) mail: IdentityMailService,
    @Inject(INITIAL_IDENTITY_RELATIONS) relations: InitialIdentityRelations,
    @Inject(PinoLogger) logger: PinoLogger,
  ) {
    this.auth = createIdentityAuth(
      config,
      identityClient(database.client, relations),
      (message) => mail.send(message),
      () => logger.warn({ provider: 'better-auth' }, 'Identity provider event'),
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
    return result.response;
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
}
