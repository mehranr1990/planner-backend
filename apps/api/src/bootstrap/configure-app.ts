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
import { trustedOrigins } from './environment.js';

export async function configureApp(app: NestExpressApplication): Promise<void> {
  app.use(requestContext);
  app.useLogger(app.get(Logger));
  const errors = new ApiExceptionFilter();
  const config = app.get<AppConfig>(APP_CONFIG);
  const origins = trustedOrigins(config);
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
    ],
    exposedHeaders: [
      'X-Request-Id',
      'X-Correlation-Id',
      'ETag',
      'Content-Disposition',
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
  app.useGlobalFilters(errors);
  app.setGlobalPrefix('api/v1', {
    exclude: Object.values(healthRoutes).map((path) => ({
      path,
      method: RequestMethod.GET,
    })),
  });
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.useBodyParser('json', { limit: '128kb' });
  app.enableShutdownHooks();
  await app.init();
  // Nest 12 scopes its 404 handler to the API prefix and excluded health routes.
  // Unmatched root paths must also obey the JSON error contract.
  app.use((req: Request, res: Response) =>
    errors.reply(new NotFoundException(), req as ContextRequest, res),
  );
}
