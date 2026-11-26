import {
  All,
  Controller,
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
import { adminAnalyticsRoutes } from '@mehran/api-contracts';
import { RequireAdmin } from '../../platform/admin/admin.guard.js';
import { AdminService } from '../../platform/admin/admin.service.js';
import { AdminCommand } from '../../platform/admin/admin-command.js';
import { APP_CONFIG } from '../../bootstrap/configuration.module.js';
import { trustedOrigins, type AppConfig } from '../../bootstrap/environment.js';
import { ZodValidationPipe } from '../../bootstrap/zod-validation.pipe.js';
import type { ContextRequest } from '../../bootstrap/request-context.js';
import type { ActorRequest } from '../../platform/auth/request-actor.js';
import { VerifiedSessionGuard } from '../../platform/auth/session.guard.js';
import { AnalyticsService } from './analytics.service.js';

const configJson = (v: unknown) => JSON.parse(JSON.stringify(v));
@Controller('admin')
@RequireAdmin('admin.session.read')
export class AnalyticsController {
  constructor(
    @Inject(AdminService) readonly admin: AdminService,
    @Inject(AnalyticsService) readonly service: AnalyticsService,
    @Inject(APP_CONFIG) readonly config: AppConfig,
  ) {}
  @All([
    ...new Set(Object.keys(adminAnalyticsRoutes).map((r) => r.split(' ')[1]!)),
  ])
  async handle(@Req() req: ContextRequest, @Res() res: Response) {
    const parts = req.path.slice('/api/v1/admin/'.length).split('/');
    const route = (
      Object.keys(adminAnalyticsRoutes) as (keyof typeof adminAnalyticsRoutes)[]
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
      const spec = adminAnalyticsRoutes[route],
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

@Controller('analytics')
@UseGuards(VerifiedSessionGuard)
export class AnalyticsNavigationController {
  constructor(
    @Inject(AnalyticsService) readonly service: AnalyticsService,
    @Inject(APP_CONFIG) readonly config: AppConfig,
  ) {}
  @Post('navigation') async collect(
    @Req() req: ActorRequest,
    @Res() res: Response,
  ) {
    if (
      !req.headers.origin ||
      !trustedOrigins(this.config).includes(req.headers.origin)
    )
      throw new ForbiddenException();
    new ZodValidationPipe(z.strictObject({})).transform(req.query);
    const b = new ZodValidationPipe(AnalyticsNavigationSchema).transform(
      req.body,
    ) as z.infer<typeof AnalyticsNavigationSchema>;
    await this.service.navigation(req.actor, b.workspaceId, b.eventId);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ accepted: true });
  }
}
import { Post } from '@nestjs/common';
import { AnalyticsNavigationSchema } from '@mehran/api-contracts';
