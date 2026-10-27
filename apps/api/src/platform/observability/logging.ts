import type { Params } from 'nestjs-pino';
import type { ContextRequest } from '../../bootstrap/request-context.js';
import type { AppConfig } from '../../bootstrap/environment.js';

export function loggingOptions(config: AppConfig): Params {
  return {
    pinoHttp: {
      level: config.LOG_LEVEL,
      genReqId: (req) => (req as ContextRequest).id,
      customProps: (req) => ({
        correlationId: (req as ContextRequest).correlationId,
      }),
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
          'req.body',
          'req.query',
          'password',
          'token',
          'secret',
          'DATABASE_URL',
          'BETTER_AUTH_SECRET',
          'SMTP_PASSWORD',
          '*.password',
          '*.token',
          '*.secret',
          '*.body',
          '*.content',
          '*.fileUrl',
        ],
        censor: '[REDACTED]',
      },
      // Whitelists omit URLs (including signed links), headers, bodies and private content.
      serializers: {
        req: (req: { id?: string; method?: string }) => ({
          id: req.id,
          method: req.method,
        }),
        res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
        err: () => ({ type: 'RequestError' }),
      },
    },
  };
}
