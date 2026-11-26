import {
  ForbiddenException,
  NotFoundException,
  RequestMethod,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { healthRoutes } from '@mehran/api-contracts';
import { ApiExceptionFilter } from './api-exception.filter.js';
import { requestContext } from './request-context.js';
import type { ContextRequest } from './request-context.js';
import type { Request, Response, NextFunction } from 'express';
import { APP_CONFIG } from './configuration.module.js';
import type { AppConfig } from './environment.js';
import { applyTrustedProxies, trustedOrigins } from './environment.js';
import { ApiMetrics } from '../platform/operations/api-metrics.js';
import { OperationsControl } from '../platform/operations/operations-control.js';
import { trafficBinding } from '../platform/configuration/traffic.js';

export async function configureApp(app: NestExpressApplication): Promise<void> {
  app.use(requestContext);
  app.useLogger(app.get(Logger));
  const errors = new ApiExceptionFilter();
  const config = app.get<AppConfig>(APP_CONFIG);
  const metrics = app.get(ApiMetrics),
    operations = app.get(OperationsControl);
  const origins = trustedOrigins(config);
  applyTrustedProxies(
    app.getHttpAdapter().getInstance(),
    config.TRUSTED_PROXY_ADDRESSES,
  );
  app.enableCors({
    origin: origins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'X-Request-Id',
      'X-Correlation-Id',
      'If-Match',
      'Idempotency-Key',
      'X-Export-Proof',
      'X-Deletion-Proof',
      'X-Deletion-Recovery',
      'X-Invitation-Proof',
    ],
    exposedHeaders: [
      'X-Account-Suspension-Reason',
      'X-Request-Id',
      'X-Correlation-Id',
      'ETag',
      'Content-Disposition',
      'X-Export-Id',
      'Retry-After',
      'RateLimit-Limit',
      'RateLimit-Remaining',
      'RateLimit-Reset',
      'RateLimit-Policy',
    ],
  });
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    if (config.NODE_ENV === 'production')
      res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      !origins.includes(req.headers.origin ?? '')
    ) {
      errors.reply(new ForbiddenException(), req as ContextRequest, res);
      return;
    }
    next();
  });
  app.use((req: Request, res: Response, next: NextFunction) => {
    const finish = metrics.begin();
    res.once('finish', () => finish(res.statusCode));
    res.once('close', () =>
      finish(res.writableFinished ? res.statusCode : 499),
    );
    if (
      /^\/api\/v1\/admin(?:\/|$)/i.test(req.path) ||
      req.path.toLowerCase() === '/health/live' ||
      req.path.toLowerCase() === '/api/v1/platform/maintenance'
    ) {
      next();
      return;
    }
    void operations
      .assert(trafficBinding(req.path, req.method) ?? undefined)
      .then(() => next())
      .catch((error: unknown) =>
        errors.reply(error, req as ContextRequest, res),
      );
  });
  app.useGlobalFilters(errors);
  app.setGlobalPrefix('api/v1', {
    exclude: Object.values(healthRoutes).map((path) => ({
      path,
      method: RequestMethod.GET,
    })),
  });
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.useBodyParser('json', {
    limit: '7mb',
    type: (req) =>
      req.method === 'POST' &&
      /^\/api\/v1\/(?:support\/tickets|moderation\/reports)\/[a-f0-9-]{36}\/evidence$/.test(
        (req.url ?? '').split('?')[0]!,
      ),
  });
  app.useBodyParser('json', { limit: '128kb' });
  app.enableShutdownHooks();
  await app.init();
  // Nest 12 scopes its 404 handler to the API prefix and excluded health routes.
  // Unmatched root paths must also obey the JSON error contract.
  app.use((req: Request, res: Response) =>
    errors.reply(new NotFoundException(), req as ContextRequest, res),
  );
}
