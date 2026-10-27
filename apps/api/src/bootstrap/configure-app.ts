import { NotFoundException, RequestMethod } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { healthRoutes } from '@mehran/api-contracts';
import { ApiExceptionFilter } from './api-exception.filter.js';
import { requestContext } from './request-context.js';
import type { ContextRequest } from './request-context.js';
import type { Request, Response } from 'express';

export async function configureApp(app: NestExpressApplication): Promise<void> {
  app.use(requestContext);
  app.useLogger(app.get(Logger));
  const errors = new ApiExceptionFilter();
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
