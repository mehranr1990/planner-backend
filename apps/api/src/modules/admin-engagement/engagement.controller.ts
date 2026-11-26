import {
  All,
  Controller,
  Inject,
  Req,
  Res,
  UseGuards,
  Injectable,
  NotFoundException,
  ForbiddenException,
  HttpException,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  adminEngagementRoutes as adminRoutes,
  ordinaryEngagementRoutes as userRoutes,
} from '@mehran/api-contracts';
import { AdminService } from '../../platform/admin/admin.service.js';
import { AdminCommand } from '../../platform/admin/admin-command.js';
import { RequireAdmin } from '../../platform/admin/admin.guard.js';
import { AuthService } from '../../platform/auth/auth.service.js';
import type { ContextRequest } from '../../bootstrap/request-context.js';
import type { RequestActor } from '../../platform/auth/request-actor.js';
import { APP_CONFIG } from '../../bootstrap/configuration.module.js';
import { trustedOrigins, type AppConfig } from '../../bootstrap/environment.js';
import { ZodValidationPipe } from '../../bootstrap/zod-validation.pipe.js';
import { EngagementCore, json } from './engagement-core.js';
import { EngagementEvidence } from './engagement-evidence.js';
import { EngagementQueries } from './engagement-queries.js';
import { SupportService } from './support.service.js';
import { ModerationService } from './moderation.service.js';
import { CommunicationsService } from './communications.service.js';
type UserRequest = ContextRequest & { actor: RequestActor };
const findRoute = <T extends Record<string, unknown>>(
  routes: T,
  req: ContextRequest,
  prefix: string,
) => {
  const parts = req.path.slice(prefix.length).split('/');
  return (Object.keys(routes) as (keyof T & string)[]).find((key) => {
    const [method, path] = key.split(' '),
      template = path!.split('/');
    return (
      req.method === method &&
      parts.length === template.length &&
      template.every((part, i) => part === ':id' || part === parts[i])
    );
  });
};
const identifier = (route: string, req: ContextRequest, prefix: string) => {
  const template = route.split(' ')[1]!.split('/'),
    at = template.indexOf(':id');
  if (at < 0) return undefined;
  const value = req.path.slice(prefix.length).split('/')[at];
  return route.includes('engagement/policies')
    ? (new ZodValidationPipe(
        z.enum(['SUPPORT', 'MODERATION', 'COMMUNICATIONS']),
      ).transform(value) as string)
    : (new ZodValidationPipe(z.uuid()).transform(value) as string);
};
async function streamEvidence(
  res: Response,
  value: Awaited<ReturnType<EngagementEvidence['open']>>,
) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', 'attachment; filename="case-evidence"');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
  await pipeline(value.stream, res);
}

@Injectable()
export class RegisteredSupportGuard implements CanActivate {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(EngagementCore) private readonly core: EngagementCore,
  ) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<UserRequest>(),
      res = context.switchToHttp().getResponse<Response>(),
      session = await this.auth.session(req.headers, (value) =>
        res.appendHeader('set-cookie', value),
      );
    if (!session) throw new ForbiddenException();
    if (!(await this.core.requestRate(session.user.id)))
      throw new ForbiddenException({ code: 'RATE_LIMITED' });
    req.actor = {
      userId: session.user.id,
      sessionId: session.session.id,
      requestId: req.id,
      correlationId: req.correlationId,
    };
    return true;
  }
}
@Controller('admin')
@RequireAdmin('admin.session.read')
export class EngagementAdminController {
  constructor(
    @Inject(AdminService) private readonly admin: AdminService,
    @Inject(EngagementCore) private readonly core: EngagementCore,
    @Inject(EngagementQueries) private readonly queries: EngagementQueries,
    @Inject(SupportService) private readonly support: SupportService,
    @Inject(ModerationService) private readonly moderation: ModerationService,
    @Inject(CommunicationsService)
    private readonly communications: CommunicationsService,
    @Inject(EngagementEvidence) private readonly evidence: EngagementEvidence,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
  @All([...new Set(Object.keys(adminRoutes).map((r) => r.split(' ')[1]!))])
  async handle(@Req() req: ContextRequest, @Res() res: Response) {
    this.core.privacy.assert();
    const route = findRoute(adminRoutes, req, '/api/v1/admin/');
    if (!route) throw new NotFoundException();
    const attempt = await this.admin.auditAttempt(route, req.id);
    let adminId: string | null = null;
    try {
      const spec = adminRoutes[route],
        actor = await this.admin.authorize(req.headers, spec.permission);
      adminId = actor.user.id;
      const write = req.method !== 'GET',
        sensitive = route.endsWith('/content') || route.endsWith('/evidence');
      if (write || sensitive) this.admin.requireRecent(actor);
      if (
        write &&
        (!req.headers.origin ||
          !trustedOrigins(this.config).includes(req.headers.origin))
      )
        throw new ForbiddenException();
      if (write) new ZodValidationPipe(z.strictObject({})).transform(req.query);
      const input = new ZodValidationPipe(spec.schema).transform(
          write ? req.body : req.query,
        ),
        id = identifier(route, req, '/api/v1/admin/');
      await this.admin.auditContext(attempt.id, spec.permission, input);
      const command = new AdminCommand(
        adminId,
        actor.session.id,
        spec.permission,
        req.id,
        attempt.id,
        sensitive
          ? randomUUID()
          : typeof req.headers['idempotency-key'] === 'string'
            ? req.headers['idempotency-key']
            : write
              ? ''
              : randomUUID(),
        json({ id: id ?? null, route, input }),
      );
      let output: unknown;
      if (route.endsWith('/evidence')) {
        const b = z.object({ evidenceId: z.uuid() }).parse(input);
        await streamEvidence(
          res,
          await this.evidence.adminDownload(
            command,
            route.startsWith('GET support')
              ? { ticketId: id! }
              : { caseId: id! },
            b.evidenceId,
          ),
        );
        return;
      }
      if (
        route.includes('/notices') ||
        route.includes('/escalations') ||
        route.includes('engagement/')
      )
        output = await this.queries.admin(route, id, input, command);
      else if (route.includes('communications'))
        output = await this.communications.handle(route, id, input, command);
      else if (route.includes('moderation'))
        output = await this.moderation.handle(route, id, input, command);
      else output = await this.support.admin(route, id, input, command);
      const result = spec.response.parse(output);
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
@Controller()
@UseGuards(RegisteredSupportGuard)
export class EngagementUserController {
  constructor(
    @Inject(EngagementCore) private readonly core: EngagementCore,
    @Inject(EngagementQueries) private readonly queries: EngagementQueries,
    @Inject(SupportService) private readonly support: SupportService,
    @Inject(ModerationService) private readonly moderation: ModerationService,
    @Inject(EngagementEvidence) private readonly evidence: EngagementEvidence,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
  @All([...new Set(Object.keys(userRoutes).map((r) => r.split(' ')[1]!))])
  async handle(@Req() req: UserRequest, @Res() res: Response) {
    const route = findRoute(userRoutes, req, '/api/v1/');
    if (!route) throw new NotFoundException();
    const write = req.method !== 'GET';
    if (
      write &&
      (!req.headers.origin ||
        !trustedOrigins(this.config).includes(req.headers.origin))
    )
      throw new ForbiddenException();
    if (write) new ZodValidationPipe(z.strictObject({})).transform(req.query);
    const spec = userRoutes[route],
      input = new ZodValidationPipe(spec.schema).transform(
        write ? req.body : req.query,
      ),
      id = identifier(route, req, '/api/v1/'),
      actor = req.actor,
      key =
        typeof req.headers['idempotency-key'] === 'string'
          ? req.headers['idempotency-key']
          : '';
    await this.core.assertIdentity(actor);
    let output: unknown;
    if (route.endsWith('/evidence')) {
      const target = route.includes('support/tickets')
        ? { ticketId: id! }
        : { caseId: id! };
      if (!write) {
        const b = z.object({ evidenceId: z.uuid() }).parse(input);
        await streamEvidence(
          res,
          await this.evidence.userDownload(actor, target, b.evidenceId),
        );
        return;
      }
      output = await this.evidence.upload(actor, key, target, input);
    } else if (route === 'POST moderation/reports')
      output = await this.moderation.report(actor, key, input);
    else if (route === 'POST moderation/reports/:id/appeal')
      output = await this.moderation.appeal(actor, id!, input, key);
    else if (route === 'GET moderation/reports/:id')
      output = await this.moderation.detail(id!, actor.userId);
    else if (
      route.includes('support/tickets') ||
      route === 'GET support/queues'
    )
      output = await this.support.ordinary(route, id, input, actor, key);
    else output = await this.queries.user(route, id, input, actor, key);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(spec.response.parse(output));
  }
}
