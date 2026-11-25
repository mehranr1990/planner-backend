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
  adminOperationsRoutes,
  PrivateFileQuerySchema,
} from '@mehran/api-contracts';
import { z } from 'zod';
import type { Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import type { ContextRequest } from '../../bootstrap/request-context.js';
import { APP_CONFIG } from '../../bootstrap/configuration.module.js';
import { trustedOrigins, type AppConfig } from '../../bootstrap/environment.js';
import { ZodValidationPipe } from '../../bootstrap/zod-validation.pipe.js';
import { AdminService } from '../admin/admin.service.js';
import { AdminCommand } from '../admin/admin-command.js';
import { RequireAdmin } from '../admin/admin.guard.js';
import { OperationsPolicy } from './operations-policy.js';
import { QueueControl } from './queue-control.js';
import { SystemHealth } from './system-health.js';
import { StorageOperations } from '../storage/storage-operations.js';
import { BackupRuns } from './backup-runs.js';

const routes = adminOperationsRoutes;
@Controller('admin')
@RequireAdmin('admin.session.read')
export class OperationsController {
  constructor(
    @Inject(AdminService) private readonly admin: AdminService,
    @Inject(OperationsPolicy) private readonly policies: OperationsPolicy,
    @Inject(QueueControl) private readonly queues: QueueControl,
    @Inject(SystemHealth) private readonly health: SystemHealth,
    @Inject(StorageOperations) private readonly storage: StorageOperations,
    @Inject(BackupRuns) private readonly backups: BackupRuns,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
  @All([...new Set(Object.keys(routes).map((r) => r.split(' ')[1]!))])
  async handle(@Req() req: ContextRequest, @Res() res: Response) {
    const parts = req.path.slice('/api/v1/admin/'.length).split('/');
    const route = (Object.keys(routes) as (keyof typeof routes)[]).find(
      (key) => {
        const [method, path] = key.split(' '),
          template = path!.split('/');
        return (
          method === req.method &&
          template.length === parts.length &&
          template.every((p, i) => p === ':id' || p === parts[i])
        );
      },
    );
    if (!route) throw new NotFoundException();
    const attempt = await this.admin.auditAttempt(route, req.id);
    let adminId: string | null = null;
    try {
      const spec = routes[route],
        actor = await this.admin.authorize(req.headers, spec.permission);
      adminId = actor.user.id;
      const write = req.method !== 'GET',
        file = route === 'GET operations/storage/files/:id/content';
      if (write || file) this.admin.requireRecent(actor);
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
      const parsed = <K extends keyof typeof routes>(key: K) =>
        routes[key].schema.parse(input) as z.infer<
          (typeof routes)[K]['schema']
        >;
      const template = route.split(' ')[1]!.split('/'),
        id = template.includes(':id')
          ? (new ZodValidationPipe(z.uuid()).transform(
              parts[template.indexOf(':id')],
            ) as string)
          : undefined;
      await this.admin.auditContext(attempt.id, spec.permission, input);
      const command = () =>
        new AdminCommand(
          actor.user.id,
          actor.session.id,
          spec.permission,
          req.id,
          attempt.id,
          file
            ? randomUUID()
            : typeof req.headers['idempotency-key'] === 'string'
              ? req.headers['idempotency-key']
              : '',
          JSON.parse(JSON.stringify({ route, id: id ?? null, input })) as never,
        );
      let output: unknown;
      if (file) {
        const query = PrivateFileQuerySchema.parse(input);
        await this.admin.auditFileTarget(
          attempt.id,
          id!,
          query.spaceId,
          query.scopeId ?? null,
          query.disposition,
        );
        const result = await this.storage.privateFile(command(), id!, query);
        res.setHeader('Content-Type', result.mimeType);
        res.setHeader('Content-Length', result.size);
        res.setHeader(
          'Content-Disposition',
          result.disposition + '; filename="private-file"',
        );
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        await pipeline(result.stream, res);
        await this.admin.auditOutcome(attempt.id, 'SUCCEEDED', adminId);
        return;
      }
      if (
        route === 'GET operations/health' ||
        route === 'POST operations/health/check'
      ) {
        if (write) {
          // Persist the authorization/idempotency receipt before read-only probes.
          const cmd = command();
          await this.policies.check(cmd);
        }
        output = await this.health.snapshot();
      } else if (route === 'GET operations/policies')
        output = await this.policies.list();
      else if (route === 'POST operations/policies/preview')
        output = await this.policies.preview(command(), input);
      else if (route === 'POST operations/policies/:id/publish')
        output = await this.policies.publish(command(), id!);
      else if (route === 'GET operations/incidents')
        output = await this.health.incidents(parsed(route));
      else if (route === 'GET operations/incidents/:id/notes')
        output = await this.health.notes(id!, parsed(route));
      else if (route === 'POST operations/incidents/:id/notes')
        output = await this.health.note(command(), id!, parsed(route).note);
      else if (route === 'GET operations/jobs')
        output = await this.queues.list(parsed(route));
      else if (route === 'GET operations/job-controls/:id')
        output = await this.queues.detail(id!);
      else if (route === 'POST operations/health/repair') {
        const p = parsed(route);
        output = await this.queues.request(
          command(),
          p.action === 'DISPATCH_SWEEP' ? 'RUN' : 'CHECK',
          p.action === 'DISPATCH_SWEEP' ? 'planner.sweep' : null,
          null,
        );
      } else if (
        route === 'POST operations/jobs/run' ||
        route === 'POST operations/jobs/:id/retry' ||
        route === 'POST operations/jobs/:id/cancel'
      )
        output = await this.queues.request(
          command(),
          route.endsWith('/run')
            ? 'RUN'
            : route.endsWith('/retry')
              ? 'RETRY'
              : 'CANCEL',
          parsed(route).queue,
          id ?? null,
        );
      else if (route === 'GET operations/storage/usage')
        output = await this.storage.usage(parsed(route));
      else if (route === 'POST operations/storage/cleanup/preview')
        output = await this.storage.preview(command());
      else if (route === 'POST operations/storage/cleanup/:id/apply')
        output = await this.storage.cleanup(
          command(),
          id!,
          parsed(route).fingerprint,
        );
      else if (route === 'GET operations/backups')
        output = await this.backups.list('backup', parsed(route));
      else if (route === 'GET operations/backups/:id')
        output = await this.backups.detail(id!);
      else if (route === 'POST operations/backups')
        output = await this.backups.request(command());
      else if (route === 'GET operations/restores')
        output = await this.backups.list('restore', parsed(route));
      else if (route === 'POST operations/restores')
        output = await this.backups.restore(command(), parsed(route));
      else if (route === 'POST operations/restores/:id/approve')
        output = await this.backups.approve(command(), id!, parsed(route));
      else throw new NotFoundException();
      const result = spec.response.parse(output);
      if (!write)
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
