import { z } from 'zod';
import * as c from './lifecycle.js';
import * as s from './sync.js';
export function lifecyclePaths(): Record<string, Record<string, unknown>> {
  const paths: Record<string, Record<string, unknown>> = {},
    json = (schema: z.ZodType) =>
      z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' });
  const add = (
    path: string,
    method: string,
    output: z.ZodType | null,
    input?: z.ZodType,
    query?: z.ZodObject,
    header?: string,
    anonymous = false,
    idempotency = false,
  ) => {
    const parameters: unknown[] = [];
    for (const id of path.matchAll(/\{(\w+)\}/g))
      parameters.push({
        in: 'path',
        name: id[1],
        required: true,
        schema: { type: 'string', format: 'uuid' },
      });
    for (const [name, schema] of Object.entries(query?.shape ?? {}))
      parameters.push({
        in: 'query',
        name,
        required: !(schema as z.ZodType).isOptional(),
        schema: json(schema as z.ZodType),
      });
    if (header)
      parameters.push({
        in: 'header',
        name: header,
        required: true,
        schema: { type: 'string', maxLength: 1024 },
      });
    if (idempotency)
      parameters.push({
        in: 'header',
        name: 'Idempotency-Key',
        required: true,
        schema: {
          type: 'string',
          minLength: 1,
          maxLength: 128,
          pattern: '^[!-~]+$',
        },
      });
    if (method === 'post')
      parameters.push({
        in: 'header',
        name: 'Origin',
        required: true,
        schema: { type: 'string', format: 'uri' },
      });
    const responses: Record<string, unknown> = {
      [method === 'post' ? 201 : 200]: {
        description: 'Authorized P1-12 result under ADRs 0022/0023',
        content: output
          ? { 'application/json': { schema: json(output) } }
          : {
              'application/octet-stream': {
                schema: { type: 'string', format: 'binary' },
              },
            },
      },
    };
    for (const code of [400, 401, 403, 404, 409, 413, 422, 429, 500, 503])
      responses[code] = {
        description: 'Safe error',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiError' },
          },
        },
      };
    paths['/api/v1' + path] ??= {};
    paths['/api/v1' + path]![method] = {
      operationId: method + path.replace(/[^a-zA-Z]/g, ''),
      tags: [path.startsWith('/sync') ? 'sync' : 'personal-lifecycle'],
      security: anonymous ? [] : [{ sessionCookie: [] }],
      parameters,
      ...(input
        ? {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: json(input) } },
            },
          }
        : {}),
      responses,
    };
  };
  add('/sync/status', 'get', s.SyncStatusSchema);
  add(
    '/sync/pull',
    'get',
    s.SyncPullResultSchema,
    undefined,
    s.SyncPullQuerySchema,
  );
  add('/sync/push', 'post', s.SyncPushResultSchema, s.SyncPushSchema);
  add(
    '/me/export',
    'post',
    c.ExportJobSchema,
    c.ExportRequestSchema,
    undefined,
    undefined,
    false,
    true,
  );
  add('/me/exports/{id}', 'get', c.ExportJobSchema);
  add(
    '/me/exports/{id}/download',
    'get',
    null,
    undefined,
    undefined,
    'X-Export-Proof',
  );
  add(
    '/me/exports/{id}/attachments/{fileId}',
    'get',
    null,
    undefined,
    undefined,
    'X-Export-Proof',
  );
  add(
    '/me/deletion-request',
    'post',
    c.DeletionChallengeSchema,
    c.DeletionRequestSchema,
    undefined,
    undefined,
    false,
    true,
  );
  add(
    '/me/deletion-request',
    'get',
    c.DeletionJobSchema,
    undefined,
    c.DeletionStatusQuerySchema,
    'X-Deletion-Recovery',
    true,
  );
  add(
    '/me/deletion-request/confirm',
    'post',
    c.DeletionJobSchema,
    c.DeletionConfirmSchema,
    undefined,
    'X-Deletion-Proof',
    true,
  );
  add(
    '/me/deletion-request/cancel',
    'post',
    c.DeletionJobSchema,
    c.DeletionCancelSchema,
    undefined,
    'X-Deletion-Recovery',
    true,
  );
  return paths;
}
