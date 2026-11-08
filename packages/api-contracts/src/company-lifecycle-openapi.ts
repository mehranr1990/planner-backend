import { z } from 'zod';
import * as c from './index.js';
import { ProjectEmptySchema } from './projects.js';
import { embeddedJsonSchema, pointerSegment } from './embedded-json-schema.js';
type Operation = {
  path: string;
  method: 'get' | 'post';
  output: z.ZodType;
  input?: z.ZodType;
  query?: z.ZodType;
  revision?: boolean;
  idempotency?: boolean;
  etag?: boolean;
  status200?: boolean;
  proof?: boolean;
};
export const companyLifecycleOperations: Operation[] = [
  {
    path: '/companies/{id}/archive',
    method: 'post',
    output: c.CompanyLifecycleChangeSchema,
    input: c.CollaborationEmptySchema,
    revision: true,
    status200: true,
    etag: true,
  },
  {
    path: '/companies/{id}/restore',
    method: 'post',
    output: c.CompanyLifecycleChangeSchema,
    input: c.CollaborationEmptySchema,
    revision: true,
    status200: true,
    etag: true,
  },
  {
    path: '/companies/{id}/delete',
    method: 'post',
    output: c.CompanyLifecycleChangeSchema,
    input: c.CompanyLifecyclePasswordSchema,
    revision: true,
    status200: true,
    etag: true,
  },
  {
    path: '/companies/{id}/status',
    method: 'get',
    output: c.CompanyLifecycleStatusSchema,
    status200: true,
  },
  {
    path: '/companies/{id}/ownership-handovers',
    method: 'post',
    output: c.OwnerHandoverSchema,
    input: c.HandoverCreateSchema,
    idempotency: true,
    etag: true,
  },
  {
    path: '/companies/{id}/ownership-handovers/{handoverId}',
    method: 'get',
    output: c.OwnerHandoverSchema,
    status200: true,
    etag: true,
  },
  {
    path: '/companies/{id}/ownership-handovers/{handoverId}/accept',
    method: 'post',
    output: c.OwnerHandoverSchema,
    input: c.HandoverAcceptSchema,
    revision: true,
    status200: true,
    etag: true,
  },
  {
    path: '/companies/{id}/ownership-handovers/{handoverId}/decline',
    method: 'post',
    output: c.OwnerHandoverSchema,
    input: c.CollaborationEmptySchema,
    revision: true,
    status200: true,
    etag: true,
  },
  {
    path: '/companies/{id}/ownership-handovers/{handoverId}/revoke',
    method: 'post',
    output: c.OwnerHandoverSchema,
    input: c.CollaborationEmptySchema,
    revision: true,
    status200: true,
    etag: true,
  },
  {
    path: '/companies/{id}/lifecycle-job',
    method: 'get',
    output: c.CompanyLifecycleJobSchema,
    status200: true,
    etag: true,
  },
  {
    path: '/companies/{id}/lifecycle-job/recovery-proof',
    method: 'post',
    output: c.CompanyLifecycleProofSchema,
    input: c.CompanyLifecyclePasswordSchema,
    revision: true,
    status200: true,
    etag: true,
  },
  {
    path: '/companies/{id}/lifecycle-job/recover',
    method: 'post',
    output: c.CompanyLifecycleRecoverySchema,
    input: c.CompanyLifecycleRecoverSchema,
    revision: true,
    status200: true,
    proof: true,
    etag: true,
  },
];
export function companyLifecyclePaths() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of companyLifecycleOperations) {
    const path = '/api/v1' + op.path,
      pointer = '#/paths/' + pointerSegment(path) + '/' + op.method;
    const schema = (value: z.ZodType, at: string) =>
      embeddedJsonSchema(
        z.toJSONSchema(value, { target: 'draft-2020-12', io: 'input' }),
        at,
      );
    const parameters: unknown[] = [...op.path.matchAll(/\{(\w+)\}/g)].map(
      (m) => ({
        in: 'path',
        name: m[1],
        required: true,
        schema: { type: 'string', format: 'uuid' },
      }),
    );
    if (op.method !== 'get')
      parameters.push({
        in: 'header',
        name: 'Origin',
        required: true,
        schema: { type: 'string', format: 'uri' },
      });
    if (op.revision)
      parameters.push({
        in: 'header',
        name: 'If-Match',
        required: true,
        schema: { type: 'string', pattern: '^"[1-9][0-9]*"$' },
      });
    if (op.idempotency)
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
    if (op.query) {
      const q = z.toJSONSchema(op.query, { io: 'input' }) as {
        properties: Record<string, unknown>;
        required?: string[];
      };
      for (const [name, value] of Object.entries(q.properties))
        parameters.push({
          in: 'query',
          name,
          required: q.required?.includes(name) ?? false,
          schema: value,
        });
    }
    if (op.proof)
      parameters.push({
        in: 'header',
        name: 'X-Deletion-Recovery',
        required: true,
        schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' },
      });
    const responses: Record<string, unknown> = {
      [op.method === 'post' && !op.status200 ? 201 : 200]: {
        description: 'Current authorized P3-05 result',
        headers: {
          'Cache-Control': { schema: { type: 'string', const: 'no-store' } },
          ...(op.etag ? { ETag: { schema: { type: 'string' } } } : {}),
        },
        content: {
          'application/json': {
            schema: schema(
              op.output,
              pointer +
                '/responses/' +
                (op.method === 'post' && !op.status200 ? 201 : 200) +
                '/content/application~1json/schema',
            ),
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
    paths[path] ??= {};
    paths[path]![op.method] = {
      operationId:
        'companyLifecycle' + op.method + op.path.replace(/[^a-zA-Z]/g, ''),
      tags: ['company-lifecycle'],
      security: [{ sessionCookie: [] }],
      parameters,
      responses,
      ...(op.input
        ? {
            requestBody: {
              required:
                op.input !== ProjectEmptySchema &&
                op.input !== c.CollaborationEmptySchema,
              content: {
                'application/json': {
                  schema: schema(
                    op.input,
                    pointer + '/requestBody/content/application~1json/schema',
                  ),
                },
              },
            },
          }
        : {}),
    };
  }
  return paths;
}
