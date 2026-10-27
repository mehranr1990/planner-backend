import { describe, expect, it } from 'vitest';
import { pino } from 'pino';
import type { LoggerOptions } from 'pino';
import { loggingOptions } from './logging.js';
import { parseEnvironment } from '../../bootstrap/environment.js';

describe('structured log privacy', () => {
  it('omits sensitive HTTP data, error content and configured secret fields', () => {
    let output = '';
    const config = parseEnvironment({
      DATABASE_URL: 'postgresql://localhost/unused_test',
    });
    const logger = pino(loggingOptions(config).pinoHttp as LoggerOptions, {
      write(chunk) {
        output += chunk;
      },
    });
    logger.info(
      {
        req: {
          id: 'safe-id',
          method: 'POST',
          url: '/files/secret-file?token=private-token',
          headers: { authorization: 'secret-bearer', cookie: 'private-cookie' },
          body: {
            journal: 'private-journal',
            mood: 'private-mood',
            finance: 'private-finance',
          },
        },
        res: { statusCode: 200, headers: { 'set-cookie': 'private-session' } },
        err: new Error('private-exception'),
        password: 'private-password',
        nested: { token: 'private-nested-token', content: 'private-content' },
      },
      'Safe message',
    );
    expect(JSON.parse(output).req).toEqual({ id: 'safe-id', method: 'POST' });
    expect(output).not.toMatch(
      /secret-file|private-token|secret-bearer|private-cookie|private-journal|private-mood|private-finance|private-session|private-exception|private-password|private-nested-token|private-content/,
    );
    expect(JSON.parse(output).msg).toBe('Safe message');
  });
});
