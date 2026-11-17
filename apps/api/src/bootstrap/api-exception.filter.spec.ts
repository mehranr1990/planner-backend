import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { ApiErrorSchema } from '@mehran/api-contracts';
import { ApiExceptionFilter } from './api-exception.filter.js';
import type { ContextRequest } from './request-context.js';

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

it('keeps unknown, unstructured and non-conflict exceptions private', () => {
  for (const exception of [
    new ConflictException({
      code: 'private SQL',
      details: [{ path: 'password', code: 'secret' }],
    }),
    new ConflictException('private SQL'),
    new ForbiddenException({ code: 'PROJECT_KEY_CONFLICT' }),
    new BadRequestException({ code: 'PROJECT_KEY_CONFLICT' }),
  ]) {
    const { body } = reply(exception);
    expect(body.error.details).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(
      /private|SQL|password|secret|PROJECT_KEY_CONFLICT/,
    );
  }
});
