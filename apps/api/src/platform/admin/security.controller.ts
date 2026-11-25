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
import {
  adminSecurityRoutes,
  adminRetentionRoutes,
} from '@mehran/api-contracts';
import { AdminAuditRetention } from './audit-retention.service.js';
import { z } from 'zod';
import type { Response } from 'express';
import type { ContextRequest } from '../../bootstrap/request-context.js';
import { APP_CONFIG } from '../../bootstrap/configuration.module.js';
import { trustedOrigins, type AppConfig } from '../../bootstrap/environment.js';
import { ZodValidationPipe } from '../../bootstrap/zod-validation.pipe.js';
import { RequireAdmin } from './admin.guard.js';
import { AdminService } from './admin.service.js';
import { AdminCommand } from './admin-command.js';
import { AdminSecurityService } from './security.service.js';
import { AdminSecurityAlerts } from './security-alerts.service.js';
const routes = { ...adminSecurityRoutes, ...adminRetentionRoutes };

@Controller('admin')
@RequireAdmin('admin.session.read')
export class AdminSecurityController {
  constructor(
    @Inject(AdminAuditRetention)
    private readonly retention: AdminAuditRetention,
    @Inject(AdminSecurityAlerts) private readonly alerts: AdminSecurityAlerts,
    @Inject(AdminService) private readonly admin: AdminService,
    @Inject(AdminSecurityService)
    private readonly security: AdminSecurityService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
  @All([...new Set(Object.keys(routes).map((r) => r.split(' ')[1]!))])
  async handle(@Req() req: ContextRequest, @Res() res: Response) {
    const path = req.path.slice('/api/v1/admin/'.length).split('/');
    const route = (Object.keys(routes) as (keyof typeof routes)[]).find(
      (key) => {
        const [method, template] = key.split(' ');
        const parts = template!.split('/');
        return (
          method === req.method &&
          parts.length === path.length &&
          parts.every((p, i) => p === ':id' || p === path[i])
        );
      },
    );
    if (!route) throw new NotFoundException();
    const event = await this.admin.auditAttempt(route, req.id);
    let adminId: string | null = null;
    try {
      const spec = routes[route];
      const actor = await this.admin.authorize(req.headers, spec.permission);
      adminId = actor.user.id;
      const write = req.method !== 'GET';
      if (write) {
        if (
          !req.headers.origin ||
          !trustedOrigins(this.config).includes(req.headers.origin)
        )
          throw new ForbiddenException();
        this.admin.requireRecent(actor);
        new ZodValidationPipe(z.strictObject({})).transform(req.query);
      }
      const input = new ZodValidationPipe(spec.schema).transform(
        write ? req.body : req.query,
      );
      const id = route.includes(':id')
        ? (new ZodValidationPipe(z.uuid()).transform(
            path[route.split(' ')[1]!.split('/').indexOf(':id')],
          ) as string)
        : undefined;
      const adminTarget = route.includes('security/admins/')
        ? id
        : input &&
            typeof input === 'object' &&
            'targetAdminId' in input &&
            typeof input.targetAdminId === 'string'
          ? input.targetAdminId
          : undefined;
      await this.admin.auditContext(
        event.id,
        spec.permission,
        input,
        adminTarget ? { adminId: adminTarget } : undefined,
      );
      let output: unknown;
      if (route === 'GET security/policy')
        output = await this.security.policy();
      else if (route === 'GET security/alerts')
        output = await this.alerts.list((input as { limit: number }).limit);
      else if (route === 'GET security/approvals/:id')
        output = await this.security.approval(id!, actor.user.id);
      else if (route === 'GET security/admins/:id/sessions')
        output = await this.security.sessions(id!);
      else if (route === 'GET privacy/retention')
        output = await this.retention.policies();
      else if (route === 'GET privacy/retention/changes/:id')
        output = await this.retention.change(id!);
      else {
        const cmd = new AdminCommand(
          actor.user.id,
          actor.session.id,
          spec.permission,
          req.id,
          event.id,
          typeof req.headers['idempotency-key'] === 'string'
            ? req.headers['idempotency-key']
            : '',
          JSON.parse(JSON.stringify({ route, id: id ?? null, input })) as never,
        );
        const operation =
          route === 'POST security/approvals'
            ? 'request'
            : route.endsWith('/revoke-sessions')
              ? 'revoke'
              : route.split('/').at(-1)!;
        output = route.startsWith('POST privacy/')
          ? await this.retention.mutate(
              cmd,
              route.split('/').at(-1)!,
              id,
              input,
            )
          : await this.security.mutate(cmd, operation, id, input);
      }
      const result = spec.response.parse(output);
      if (!write) await this.admin.auditOutcome(event.id, 'SUCCEEDED', adminId);
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(result);
    } catch (error) {
      await this.admin.auditOutcome(
        event.id,
        error instanceof HttpException && error.getStatus() < 500
          ? 'DENIED'
          : 'FAILED',
        adminId,
      );
      throw error;
    }
  }
}
