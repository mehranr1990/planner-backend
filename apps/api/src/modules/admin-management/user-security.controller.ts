import {
  All,
  Controller,
  Inject,
  Req,
  Res,
  NotFoundException,
  ForbiddenException,
  HttpException,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { adminUserSecurityRoutes } from '@mehran/api-contracts';
import { UserSecurityService } from './user-security.service.js';
import { AdminService } from '../../platform/admin/admin.service.js';
import { RequireAdmin } from '../../platform/admin/admin.guard.js';
import { AdminCommand } from '../../platform/admin/admin-command.js';
import { ZodValidationPipe } from '../../bootstrap/zod-validation.pipe.js';
import { APP_CONFIG } from '../../bootstrap/configuration.module.js';
import { trustedOrigins, type AppConfig } from '../../bootstrap/environment.js';
import type { ContextRequest } from '../../bootstrap/request-context.js';
@Controller('admin/security/users')
@RequireAdmin('admin.session.read')
export class UserSecurityController {
  constructor(
    @Inject(UserSecurityService) private readonly service: UserSecurityService,
    @Inject(AdminService) private readonly admin: AdminService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
  @All([
    ':id/sessions',
    ':id/revoke-sessions',
    ':id/block-login',
    ':id/unblock-login',
    ':id/recovery',
  ])
  async handle(@Req() req: ContextRequest, @Res() res: Response) {
    const parts = req.path.split('/');
    const route =
      `${req.method} security/users/:id/${parts.at(-1)}` as keyof typeof adminUserSecurityRoutes;
    if (!Object.hasOwn(adminUserSecurityRoutes, route))
      throw new NotFoundException();
    const spec = adminUserSecurityRoutes[route],
      event = await this.admin.auditAttempt(route, req.id);
    let actorId: string | null = null;
    try {
      const actor = await this.admin.authorize(req.headers, spec.permission);
      actorId = actor.user.id;
      const id = new ZodValidationPipe(z.uuid()).transform(
        parts.at(-2),
      ) as string;
      const write = req.method !== 'GET';
      if (write) {
        this.admin.requireRecent(actor);
        if (
          !req.headers.origin ||
          !trustedOrigins(this.config).includes(req.headers.origin)
        )
          throw new ForbiddenException();
        new ZodValidationPipe(z.strictObject({})).transform(req.query);
      }
      const input = new ZodValidationPipe(spec.schema).transform(
        write ? req.body : req.query,
      );
      await this.admin.auditContext(event.id, spec.permission, input, {
        userId: id,
      });
      let output: unknown;
      if (!write) {
        output = await this.service.sessions(id);
        await this.admin.auditOutcome(event.id, 'SUCCEEDED', actorId);
      } else {
        const cmd = new AdminCommand(
          actorId,
          actor.session.id,
          spec.permission,
          req.id,
          event.id,
          typeof req.headers['idempotency-key'] === 'string'
            ? req.headers['idempotency-key']
            : '',
          JSON.parse(JSON.stringify({ route, id, input })) as never,
        );
        output = await this.service.mutate(
          cmd,
          id,
          parts.at(-1)!,
          input as { revision: number; reason: string },
        );
      }
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(spec.response.parse(output));
    } catch (error) {
      await this.admin.auditOutcome(
        event.id,
        error instanceof HttpException && error.getStatus() < 500
          ? 'DENIED'
          : 'FAILED',
        actorId,
      );
      throw error;
    }
  }
}
