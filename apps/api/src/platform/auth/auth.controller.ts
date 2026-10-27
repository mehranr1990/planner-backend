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

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly identity: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @All('*path')
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
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
      res.status(result.status).end();
      return;
    }
    const body: unknown = await result.json();
    const responseSchema = authResponseSchemas[key];
    res
      .status(result.status)
      .json(responseSchema ? responseSchema.parse(body) : body);
  }
}
