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
import { adminPrivacyRoutes } from '@mehran/api-contracts';
import { AdminPrivacyService } from './privacy.service.js';
import { AdminService } from '../../platform/admin/admin.service.js';
import { RequireAdmin } from '../../platform/admin/admin.guard.js';
import { AdminCommand } from '../../platform/admin/admin-command.js';
import { ZodValidationPipe } from '../../bootstrap/zod-validation.pipe.js';
import { APP_CONFIG } from '../../bootstrap/configuration.module.js';
import { trustedOrigins, type AppConfig } from '../../bootstrap/environment.js';
import type { ContextRequest } from '../../bootstrap/request-context.js';
@Controller('admin')
@RequireAdmin('admin.session.read')
export class AdminPrivacyController {
  constructor(
    @Inject(AdminPrivacyService) private readonly privacy: AdminPrivacyService,
    @Inject(AdminService) private readonly admin: AdminService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
  @All([
    ...new Set(Object.keys(adminPrivacyRoutes).map((r) => r.split(' ')[1]!)),
  ])
  async handle(@Req() req: ContextRequest, @Res() res: Response) {
    const path = req.path.slice('/api/v1/admin/'.length).split('/');
    const route = (
      Object.keys(adminPrivacyRoutes) as (keyof typeof adminPrivacyRoutes)[]
    ).find((r) => {
      const [method, template] = r.split(' ');
      const parts = template!.split('/');
      return (
        method === req.method &&
        parts.length === path.length &&
        parts.every((p, i) => p === ':id' || p === path[i])
      );
    });
    if (!route) throw new NotFoundException();
    const event = await this.admin.auditAttempt(route, req.id);
    let actorId: string | null = null;
    try {
      const spec = adminPrivacyRoutes[route],
        actor = await this.admin.authorize(req.headers, spec.permission);
      actorId = actor.user.id;
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
      const id = route.includes(':id')
        ? (new ZodValidationPipe(z.uuid()).transform(
            path[route.split(' ')[1]!.split('/').indexOf(':id')],
          ) as string)
        : undefined;
      const target =
        input &&
        typeof input === 'object' &&
        'kind' in input &&
        'targetId' in input &&
        typeof input.targetId === 'string'
          ? input.kind === 'ACCOUNT'
            ? { userId: input.targetId }
            : { spaceId: input.targetId }
          : undefined;
      await this.admin.auditContext(event.id, spec.permission, input, target);
      let output: unknown;
      if (!write) {
        output = route.endsWith('/history')
          ? await this.privacy.history(id!)
          : await this.privacy.detail(id!);
        await this.admin.auditOutcome(event.id, 'SUCCEEDED', actorId);
      } else {
        const command = new AdminCommand(
          actorId,
          actor.session.id,
          spec.permission,
          req.id,
          event.id,
          typeof req.headers['idempotency-key'] === 'string'
            ? req.headers['idempotency-key']
            : '',
          JSON.parse(JSON.stringify({ route, id: id ?? null, input })) as never,
        );
        output = await this.privacy.mutate(
          command,
          route === 'POST privacy/deletion-requests'
            ? 'request'
            : route.split('/').at(-1)!,
          id,
          input,
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
