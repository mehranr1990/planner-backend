import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
} from '@nestjs/common';
import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { ApiErrorSchema } from '@mehran/api-contracts';
import { ApiExceptionFilter } from './api-exception.filter.js';
import type { ContextRequest } from './request-context.js';
import { RateLimitException } from './rate-limit.js';

function reply(exception: unknown) {
  const json = vi.fn(),
    status = vi.fn().mockReturnThis(),
    id = randomUUID();
  new ApiExceptionFilter().reply(
    exception,
    { id } as ContextRequest,
    { status, json } as unknown as Response,
  );
  return { status, body: ApiErrorSchema.parse(json.mock.calls[0]![0]), id };
}

it.each([
  'PROJECT_KEY_CONFLICT',
  'TASK_HAS_ACTIVE_CHILDREN',
  'WORKFLOW_DRAFT_TERMINAL',
  'WORKFLOW_PUBLICATION_CONFLICT',
  'RESTORE_EXPIRED',
  'RECOVERY_EXPIRED',
  'RECOVERY_UNAVAILABLE',
])(
  'exposes only the reviewed %s reason with the existing conflict envelope',
  (code) => {
    const { status, body, id } = reply(
      new ConflictException({
        code,
        message: 'private SQL',
        taskId: 'private-id',
      }),
    );
    expect(status).toHaveBeenCalledWith(409);
    expect(body).toEqual({
      error: {
        code: 'CONFLICT',
        message: 'Resource conflict',
        requestId: id,
        details: [{ path: '', code }],
      },
    });
  },
);

it.each(['SHARED_ACTIVATION_GATED', 'SHARED_RETENTION_UNAVAILABLE'])(
  'exposes only the reviewed %s gate with the generic forbidden envelope',
  (code) => {
    const { status, body, id } = reply(
      new ForbiddenException({ code, message: 'private policy', spaceId: 'x' }),
    );
    expect(status).toHaveBeenCalledWith(403);
    expect(body).toEqual({
      error: {
        code: 'FORBIDDEN',
        message: 'Access denied',
        requestId: id,
        details: [{ path: '', code }],
      },
    });
  },
);

it('keeps unknown, unstructured and non-conflict exceptions private', () => {
  for (const exception of [
    new ConflictException({
      code: 'private SQL',
      details: [{ path: 'password', code: 'secret' }],
    }),
    new ConflictException('private SQL'),
    new ForbiddenException({ code: 'PROJECT_KEY_CONFLICT' }),
    new BadRequestException({ code: 'PROJECT_KEY_CONFLICT' }),
    new ForbiddenException({ code: 'SHARED_PRIVATE_POLICY' }),
    new ConflictException({ code: 'SHARED_ACTIVATION_GATED' }),
    new BadRequestException({ code: 'RECOVERY_EXPIRED' }),
    new HttpException({ code: 'RESTORE_EXPIRED' }, 404),
  ]) {
    const { body } = reply(exception);
    expect(body.error.details).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(
      /private|SQL|password|secret|PROJECT_KEY_CONFLICT|SHARED_|RE(STORE|COVERY)_/,
    );
  }
});

it('preserves provider retry timing and emits the actual Shared limiting budget', () => {
  for (const shared of [false, true]) {
    const headers = new Map<string, string>([['Retry-After', '7']]);
    const response = {
      getHeader: (name: string) => headers.get(name),
      setHeader: (name: string, value: string) => headers.set(name, value),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;
    new ApiExceptionFilter().reply(
      shared
        ? new RateLimitException({ limit: 20, remaining: 0, reset: 17 })
        : new HttpException('private provider detail', 429),
      { id: randomUUID() } as ContextRequest,
      response,
    );
    expect(headers.get('Retry-After')).toBe(shared ? '17' : '7');
    if (shared) {
      expect(headers.get('RateLimit-Limit')).toBe('20');
      expect(headers.get('RateLimit-Remaining')).toBe('0');
      expect(headers.get('RateLimit-Reset')).toBe('17');
    }
  }
});

it.each(['files', 'lifecycle'])(
  'maps the %s throttler delay to Retry-After',
  (name) => {
    const headers = new Map<string, string>([['Retry-After-' + name, '12']]);
    const response = {
      getHeader: (key: string) => headers.get(key),
      setHeader: (key: string, value: string) => headers.set(key, value),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;
    new ApiExceptionFilter().reply(
      new HttpException('private', 429),
      { id: randomUUID() } as ContextRequest,
      response,
    );
    expect(headers.get('Retry-After')).toBe('12');
  },
);
