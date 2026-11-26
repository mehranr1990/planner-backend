import {
  All,
  Get,
  Controller,
  Inject,
  Req,
  Res,
  UseGuards,
  NotFoundException,
  ForbiddenException,
  HttpException,
} from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  adminCommerceRoutes,
  ordinaryCommerceRoutes,
  publicCommerceRoutes,
} from '@mehran/api-contracts';
import { AdminService } from '../../platform/admin/admin.service.js';
import { AdminCommand } from '../../platform/admin/admin-command.js';
import { RequireAdmin } from '../../platform/admin/admin.guard.js';
import { VerifiedSessionGuard } from '../../platform/auth/session.guard.js';
import type { ActorRequest } from '../../platform/auth/request-actor.js';
import type { ContextRequest } from '../../bootstrap/request-context.js';
import { APP_CONFIG } from '../../bootstrap/configuration.module.js';
import { trustedOrigins, type AppConfig } from '../../bootstrap/environment.js';
import { ZodValidationPipe } from '../../bootstrap/zod-validation.pipe.js';
import { CommerceCore, json } from './commerce-core.js';
import { CatalogService } from './catalog.service.js';
import { SubscriptionsService } from './subscriptions.service.js';
import { BillingService } from './billing.service.js';
import { CommerceQueries } from './commerce-queries.js';
function routeFor<T extends object>(
  routes: T,
  req: ContextRequest,
  prefix: string,
) {
  const parts = req.path.slice(prefix.length).split('/');
  const route = (Object.keys(routes) as (keyof T & string)[]).find((r) => {
    const [method, path] = r.split(' '),
      template = path!.split('/');
    return (
      req.method === method &&
      parts.length === template.length &&
      template.every((p, i) => p === ':id' || p === parts[i])
    );
  });
  if (!route) throw new NotFoundException();
  const at = route.split(' ')[1]!.split('/').indexOf(':id'),
    id = at < 0 ? undefined : parts[at]!;
  return { route, id };
}
const paths = (routes: object) => [
  ...new Set(Object.keys(routes).map((r) => r.split(' ')[1]!)),
];
@Controller('admin')
@RequireAdmin('admin.session.read')
export class CommerceAdminController {
  constructor(
    @Inject(AdminService) readonly admin: AdminService,
    @Inject(CommerceCore) readonly core: CommerceCore,
    @Inject(CatalogService) readonly catalog: CatalogService,
    @Inject(SubscriptionsService) readonly subscriptions: SubscriptionsService,
    @Inject(BillingService) readonly billing: BillingService,
    @Inject(APP_CONFIG) readonly config: AppConfig,
  ) {}
  @All(paths(adminCommerceRoutes))
  async handle(@Req() req: ContextRequest, @Res() res: Response) {
    this.core.privacy.assert();
    const { route, id } = routeFor(adminCommerceRoutes, req, '/api/v1/admin/'),
      attempt = await this.admin.auditAttempt(route, req.id);
    let adminId: string | null = null;
    try {
      const spec = adminCommerceRoutes[route],
        actor = await this.admin.authorize(req.headers, spec.permission);
      adminId = actor.user.id;
      this.admin.requireRecent(actor);
      if (id) new ZodValidationPipe(z.uuid()).transform(id);
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
        json({ id: id ?? null, route, input }),
      );
      let output;
      if (route.includes('/subscriptions') || route.includes('/terms'))
        output = await this.subscriptions.handle(route, id, input, command);
      else if (
        /\/(?:invoices|payments|refunds|methods|promotions|reports|ledger|credit)(?:\/|$)/.test(
          route,
        )
      )
        output = await this.billing.handle(route, id, input, command);
      else output = await this.catalog.handle(route, id, input, command);
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
@UseGuards(VerifiedSessionGuard)
export class CommerceUserController {
  constructor(
    @Inject(CommerceQueries) readonly queries: CommerceQueries,
    @Inject(APP_CONFIG) readonly config: AppConfig,
  ) {}
  @All(paths(ordinaryCommerceRoutes))
  async handle(@Req() req: ActorRequest, @Res() res: Response) {
    const { route, id } = routeFor(ordinaryCommerceRoutes, req, '/api/v1/'),
      spec = ordinaryCommerceRoutes[route],
      write = req.method !== 'GET';
    if (id) new ZodValidationPipe(z.uuid()).transform(id);
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
      key =
        typeof req.headers['idempotency-key'] === 'string'
          ? req.headers['idempotency-key']
          : '';
    const output = await this.queries.handle(route, id!, input, req.actor, key);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(spec.response.parse(json(output)));
  }
}
@Controller()
export class CommerceCatalogController {
  constructor(@Inject(CatalogService) readonly catalog: CatalogService) {}
  @Get('commerce/catalog')
  async list(@Req() req: ContextRequest, @Res() res: Response) {
    const spec = publicCommerceRoutes['GET commerce/catalog'],
      input = new ZodValidationPipe(spec.schema).transform(req.query);
    res.setHeader('Cache-Control', 'no-store');
    res
      .status(200)
      .json(spec.response.parse(await this.catalog.publicCatalog(input)));
  }
}
