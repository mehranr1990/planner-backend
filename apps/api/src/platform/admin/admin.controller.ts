import {
  All,
  Controller,
  Inject,
  Req,
  Res,
  NotFoundException,
  HttpException,
} from '@nestjs/common';
import type { Response } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { adminAuthRoutes } from '@mehran/api-contracts';
import { AdminService } from './admin.service.js';
import { AdminAuthDispatcher } from './admin.guard.js';
import type { ContextRequest } from '../../bootstrap/request-context.js';
import { ZodValidationPipe } from '../../bootstrap/zod-validation.pipe.js';

@Controller('admin/auth')
export class AdminController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}
  @All('*path')
  @AdminAuthDispatcher()
  async handle(@Req() req: ContextRequest, @Res() res: Response) {
    const route = req.path.slice('/api/v1/admin/auth'.length);
    const key = `${req.method} ${route}`;
    const schema = adminAuthRoutes[key];
    if (!schema) throw new NotFoundException();
    const event = await this.admin.auditAttempt(key, req.id);
    try {
      const body = new ZodValidationPipe(schema).transform(
        req.method === 'GET' ? req.query : (req.body ?? {}),
      );
      if (req.method !== 'GET')
        new ZodValidationPipe(adminAuthRoutes['POST /sign-out']!).transform(
          req.query,
        );
      const publicRoute = [
        '/sign-in/email',
        '/two-factor/verify-totp',
        '/two-factor/verify-backup-code',
        '/sign-out',
      ].includes(route);
      let actor: Awaited<ReturnType<AdminService['session']>> | undefined;
      if (!publicRoute)
        actor = await this.admin.session(
          req.headers,
          route !== '/two-factor/enable',
        );
      if (route === '/two-factor/verify-totp' && req.headers.cookie) {
        try {
          actor = await this.admin.session(req.headers, false);
        } catch {
          /* challenge cookie has no session */
        }
      }
      const headers = fromNodeHeaders(req.headers);
      headers.delete('host');
      headers.delete('content-length');
      headers.set(
        'x-mehran-client-ip',
        req.ip ?? req.socket.remoteAddress ?? '127.0.0.1',
      );
      const result = await this.admin.auth.handler(
        new Request(
          new URL(req.originalUrl, (await this.admin.auth.$context).baseURL),
          {
            method: req.method,
            headers,
            ...(req.method === 'GET' ? {} : { body: JSON.stringify(body) }),
          },
        ),
      );
      if (result.status >= 400) {
        const retry = result.headers.get('x-retry-after');
        if (retry) res.setHeader('Retry-After', retry);
        throw new HttpException('Admin authentication failed', result.status);
      }
      if (
        route === '/two-factor/verify-totp' &&
        actor &&
        !actor.user.twoFactorEnabled
      ) {
        await this.admin.completeEnrollment(actor.user.id);
      }
      const output: unknown = await result.json();
      if (
        ['/two-factor/verify-totp', '/two-factor/verify-backup-code'].includes(
          route,
        ) &&
        typeof output === 'object' &&
        output !== null &&
        'token' in output &&
        typeof output.token === 'string'
      ) {
        await this.admin.confirmMfa(output.token);
      }
      const responseActor =
        typeof output === 'object' &&
        output !== null &&
        'user' in output &&
        typeof output.user === 'object' &&
        output.user !== null &&
        'id' in output.user &&
        typeof output.user.id === 'string'
          ? output.user.id
          : null;
      await this.admin.auditOutcome(
        event.id,
        'SUCCEEDED',
        actor?.user.id ?? responseActor,
      );
      for (const cookie of result.headers.getSetCookie())
        res.appendHeader('set-cookie', cookie);
      res.setHeader('Cache-Control', 'no-store');
      res.status(result.status).json(output);
    } catch (error) {
      await this.admin.auditOutcome(
        event.id,
        error instanceof HttpException && error.getStatus() < 500
          ? 'DENIED'
          : 'FAILED',
      );
      throw error;
    }
  }
}
