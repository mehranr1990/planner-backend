import { describe, expect, it } from 'vitest';
import { pino } from 'pino';
import type { LoggerOptions } from 'pino';
import { loggingOptions } from './logging.js';
import { parseEnvironment } from '../../bootstrap/environment.js';

describe('structured log privacy', () => {
  it('omits sensitive HTTP data, error content and configured secret fields', () => {
    let output = '';
    const config = parseEnvironment({
      BETTER_AUTH_SECRET: 'unit-test-only-secret-at-least-32-characters',
      BETTER_AUTH_URL: 'http://localhost:3000',
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
            reflection: 'private-reflection',
            habit: 'private-habit-title',
            quantity: 'private-habit-quantity',
            water: 'private-water-amount',
            goal: 'private-goal-title',
            metric: 'private-goal-metric',
            goalReview: 'private-goal-review',
            focus: 'private-focus-title',
            timeEntry: 'private-time-entry-note',
          },
        },
        res: { statusCode: 200, headers: { 'set-cookie': 'private-session' } },
        err: new Error('private-exception'),
        password: 'private-password',
        filename: 'private-filename',
        objectKey: 'private-object-key',
        fileUrl: 'private-file-link',
        signature: 'private-link-signature',
        nested: { token: 'private-nested-token', content: 'private-content' },
      },
      'Safe message',
    );
    expect(JSON.parse(output).req).toEqual({ id: 'safe-id', method: 'POST' });
    expect(output).not.toMatch(
      /secret-file|private-token|secret-bearer|private-cookie|private-journal|private-mood|private-finance|private-reflection|private-habit-title|private-habit-quantity|private-water-amount|private-goal-title|private-goal-metric|private-goal-review|private-focus-title|private-time-entry-note|private-session|private-exception|private-password|private-nested-token|private-content|private-filename|private-object-key|private-file-link|private-link-signature/,
    );
    expect(JSON.parse(output).msg).toBe('Safe message');
  });
});
