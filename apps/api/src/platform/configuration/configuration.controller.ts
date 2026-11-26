import {
  All,
  Controller,
  Get,
  Inject,
  Req,
  Res,
  UseGuards,
  ForbiddenException,
  NotFoundException,
  HttpException,
} from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  adminConfigurationRoutes,
  ordinaryConfigurationRoutes,
  publicConfigurationRoutes,
} from '@mehran/api-contracts';
import { RequireAdmin } from '../admin/admin.guard.js';
import { AdminService } from '../admin/admin.service.js';
import { AdminCommand } from '../admin/admin-command.js';
import { APP_CONFIG } from '../../bootstrap/configuration.module.js';
import { trustedOrigins, type AppConfig } from '../../bootstrap/environment.js';
import { ZodValidationPipe } from '../../bootstrap/zod-validation.pipe.js';
import type { ContextRequest } from '../../bootstrap/request-context.js';
import type { ActorRequest } from '../auth/request-actor.js';
import { VerifiedSessionGuard } from '../auth/session.guard.js';
import { ConfigurationService } from './configuration.service.js';
import { ConfigurationMaintenance } from './maintenance.js';
import { ConfigurationCore, configJson } from './configuration-core.js';
export const CONFIGURATION_SCOPE_AUTHORITY = Symbol(
  'CONFIGURATION_SCOPE_AUTHORITY',
);
export type ConfigurationScopeAuthority = (
  actor: ActorRequest['actor'],
  workspaceId?: string,
) => Promise<string>;
@Controller('admin')
@RequireAdmin('admin.session.read')
export class ConfigurationController {
  constructor(
    @Inject(AdminService) readonly admin: AdminService,
    @Inject(ConfigurationService) readonly service: ConfigurationService,
    @Inject(APP_CONFIG) readonly config: AppConfig,
  ) {}
  @All([
    ...new Set(
      Object.keys(adminConfigurationRoutes).map((r) => r.split(' ')[1]!),
    ),
  ])
  async handle(@Req() req: ContextRequest, @Res() res: Response) {
    const parts = req.path.slice('/api/v1/admin/'.length).split('/');
    const route = (
      Object.keys(
        adminConfigurationRoutes,
      ) as (keyof typeof adminConfigurationRoutes)[]
    ).find((r) => {
      const [method, p] = r.split(' '),
        t = p!.split('/');
      return (
        method === req.method &&
        parts.length === t.length &&
        t.every((s, i) => s === ':id' || s === parts[i])
      );
    });
    if (!route) throw new NotFoundException();
    const attempt = await this.admin.auditAttempt(route, req.id);
    let adminId: string | null = null;
    try {
      const spec = adminConfigurationRoutes[route],
        actor = await this.admin.authorize(req.headers, spec.permission);
      adminId = actor.user.id;
      this.admin.requireRecent(actor);
      const position = route.split(' ')[1]!.split('/').indexOf(':id');
      if (position >= 0)
        new ZodValidationPipe(z.uuid()).transform(parts[position]);
      const id = position < 0 ? undefined : parts[position]!;
      const write = req.method !== 'GET';
      if (
        write &&
        (!req.headers.origin ||
          !trustedOrigins(this.config).includes(req.headers.origin))
      )
        throw new ForbiddenException();
      if (write) new ZodValidationPipe(z.strictObject({})).transform(req.query);
      const input = new ZodValidationPipe(spec.schema).transform(
        write ? req.body : req.query,
      );
      await this.admin.auditContext(
        attempt.id,
        spec.permission,
        input,
        id ? { resourceId: id } : undefined,
      );
      const command = new AdminCommand(
        adminId,
        actor.session.id,
        spec.permission,
        req.id,
        attempt.id,
        write
          ? typeof req.headers['idempotency-key'] === 'string'
            ? req.headers['idempotency-key']
            : ''
          : randomUUID(),
        configJson({ route, id: id ?? null, input }),
      );
      const result = spec.response.parse(
        await this.service.handle(route, id, input, command),
      );
      await this.admin.auditOutcome(attempt.id, 'SUCCEEDED', adminId);
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(result);
    } catch (error) {
      await this.admin.auditOutcome(
        attempt.id,
        error instanceof HttpException && error.getStatus() < 500
          ? 'DENIED'
          : 'FAILED',
        adminId,
      );
      throw error;
    }
  }
}
@Controller('platform')
export class ConfigurationStatusController {
  constructor(
    @Inject(ConfigurationMaintenance)
    readonly maintenance: ConfigurationMaintenance,
  ) {}
  @Get('maintenance') async status(
    @Req() req: ContextRequest,
    @Res() res: Response,
  ) {
    new ZodValidationPipe(
      publicConfigurationRoutes['GET platform/maintenance'].schema,
    ).transform(req.query);
    const status = await this.maintenance.status();
    res.setHeader('Cache-Control', 'no-store');
    res.status(status.source === 'UNAVAILABLE' ? 503 : 200).json(status);
  }
}
@Controller('platform')
@UseGuards(VerifiedSessionGuard)
export class ConfigurationEffectiveController {
  constructor(
    @Inject(ConfigurationCore) readonly core: ConfigurationCore,
    @Inject(CONFIGURATION_SCOPE_AUTHORITY)
    readonly authority: ConfigurationScopeAuthority,
  ) {}
  @Get('configuration') async effective(
    @Req() req: ActorRequest,
    @Res() res: Response,
  ) {
    const spec = ordinaryConfigurationRoutes['GET platform/configuration'];
    new ZodValidationPipe(spec.schema).transform(req.query);
    const q = spec.schema.parse(req.query),
      workspaceId = await this.authority(req.actor, q.workspaceId);
    const result = await this.core.db.client.$transaction(async (tx) => {
      await this.core.reconcile(tx);
      const definitions = await tx.platformConfigDefinition.findMany({
        orderBy: { key: 'asc' },
        take: 500,
      });
      const items = [];
      for (const d of definitions)
        if (d.key !== 'platform.maintenance')
          items.push(
            await this.core.effective(tx, d, {
              userId: req.actor.userId,
              workspaceId,
              clientVersion: q.clientVersion,
            }),
          );
      return { items };
    });
    res.setHeader('Cache-Control', 'no-store');
    res.json(spec.response.parse(result));
  }
}
