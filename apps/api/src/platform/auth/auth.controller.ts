import {
  All,
  Controller,
  Inject,
  Req,
  Res,
  NotFoundException,
  BadRequestException,
  HttpException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import {
  authRoutes,
  authResponseSchemas,
  PasswordResetCallbackQuerySchema,
  EmptyQuerySchema,
} from '@mehran/api-contracts';
import { ZodValidationPipe } from '../../bootstrap/zod-validation.pipe.js';
import { APP_CONFIG } from '../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../bootstrap/environment.js';
import { trustedOrigins } from '../../bootstrap/environment.js';
import { AuthService } from './auth.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuditAction } from '../audit/audit.service.js';
import type { ContextRequest } from '../../bootstrap/request-context.js';

const auditActions: Record<string, AuditAction> = {
  'POST /sign-up/email': 'AUTH_SIGN_UP',
  'POST /sign-in/email': 'AUTH_SIGN_IN',
  'POST /sign-out': 'AUTH_SIGN_OUT',
  'GET /verify-email': 'AUTH_VERIFY_EMAIL',
  'POST /send-verification-email': 'AUTH_VERIFICATION_REQUEST',
  'POST /request-password-reset': 'AUTH_RECOVERY_REQUEST',
  'POST /reset-password': 'AUTH_PASSWORD_RESET',
  'POST /change-password': 'AUTH_PASSWORD_CHANGE',
  'POST /change-email': 'AUTH_EMAIL_CHANGE',
  'GET /list-sessions': 'AUTH_SESSION_LIST',
  'POST /revoke-session': 'AUTH_SESSION_REVOKE',
  'POST /revoke-sessions': 'AUTH_SESSION_REVOKE',
  'POST /revoke-other-sessions': 'AUTH_SESSION_REVOKE',
};

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly identity: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @All('*path')
  async handle(
    @Req() req: ContextRequest,
    @Res() res: Response,
  ): Promise<void> {
    const route = new URL(
      req.originalUrl,
      this.config.BETTER_AUTH_URL,
    ).pathname.slice('/api/v1/auth'.length);
    const key = `${req.method} ${route}`;
    const action = auditActions[key];
    if (!action) return this.dispatch(req, res);
    const actor = await this.identity.auditActor(req.headers);
    const event = await this.audit.record({
      action,
      outcome: 'ATTEMPTED',
      actorUserId: actor,
      requestId: req.id,
      correlationId: req.correlationId,
    });
    try {
      await this.dispatch(req, res, async (body, outcome = 'SUCCEEDED') => {
        const loginActor =
          key === 'POST /sign-in/email' &&
          typeof body === 'object' &&
          body !== null &&
          'user' in body &&
          typeof body.user === 'object' &&
          body.user !== null &&
          'id' in body.user &&
          typeof body.user.id === 'string'
            ? body.user.id
            : actor;
        await this.audit.outcome(event.id, outcome, loginActor);
      });
    } catch (error) {
      await this.audit.outcome(
        event.id,
        error instanceof HttpException && error.getStatus() < 500
          ? 'DENIED'
          : 'FAILED',
        actor,
      );
      throw error;
    }
  }

  private async dispatch(
    req: Request,
    res: Response,
    succeeded?: (
      body: unknown,
      outcome?: 'SUCCEEDED' | 'DENIED',
    ) => Promise<void>,
  ): Promise<void> {
    const url = new URL(req.originalUrl, this.config.BETTER_AUTH_URL);
    const route = url.pathname.slice('/api/v1/auth'.length);
    const key = `${req.method} ${route}`;
    const schema =
      authRoutes[key as keyof typeof authRoutes] ??
      (req.method === 'GET' && /^\/reset-password\/[^/]+$/.test(route)
        ? PasswordResetCallbackQuerySchema
        : undefined);
    if (!schema) throw new NotFoundException();
    if (req.method !== 'GET')
      new ZodValidationPipe(EmptyQuerySchema).transform(req.query);
    const parsed = new ZodValidationPipe(schema).transform(
      req.method === 'GET' ? req.query : (req.body ?? {}),
    ) as Record<string, unknown>;
    for (const field of ['callbackURL', 'redirectTo']) {
      if (typeof parsed[field] !== 'string') continue;
      let callback: URL;
      try {
        callback = new URL(parsed[field], this.config.BETTER_AUTH_URL);
      } catch {
        throw new BadRequestException();
      }
      if (
        !trustedOrigins(this.config).includes(callback.origin) ||
        callback.username ||
        callback.password
      )
        throw new BadRequestException();
    }
    const headers = fromNodeHeaders(req.headers);
    if (route === '/change-email')
      await this.identity.requireFreshSession(req.headers);
    headers.delete('host');
    headers.delete('content-length');
    // Overwrite caller-controlled proxy headers with the actual connecting IP.
    headers.set('x-mehran-client-ip', req.socket.remoteAddress ?? '127.0.0.1');
    const result = await this.identity.auth.handler(
      new globalThis.Request(url, {
        method: req.method,
        headers,
        ...(req.method === 'GET' || req.method === 'HEAD'
          ? {}
          : { body: JSON.stringify(parsed) }),
      }),
    );
    for (const cookie of result.headers.getSetCookie())
      res.appendHeader('set-cookie', cookie);
    for (const name of ['location', 'retry-after', 'x-retry-after']) {
      const value = result.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    res.setHeader('cache-control', 'no-store');
    if (result.status >= 400)
      throw new HttpException(
        'Authentication request failed',
        result.status === 422 ? 400 : result.status,
      );
    if (result.status >= 300 && result.status < 400) {
      // The provider redirects invalid/expired verification tokens with ?error=.
      // A redirect status alone must never be recorded as verified success.
      const location = result.headers.get('location');
      const failed =
        location !== null &&
        new URL(location, this.config.BETTER_AUTH_URL).searchParams.has(
          'error',
        );
      await succeeded?.(null, failed ? 'DENIED' : 'SUCCEEDED');
      res.status(result.status).end();
      return;
    }
    const body: unknown = await result.json();
    const responseSchema = authResponseSchemas[key];
    const output = responseSchema ? responseSchema.parse(body) : body;
    await succeeded?.(output);
    res.status(result.status).json(output);
  }
}
