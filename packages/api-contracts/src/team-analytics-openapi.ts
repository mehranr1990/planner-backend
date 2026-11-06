import { z } from 'zod';
import * as c from './team-analytics.js';
import { ProjectEmptySchema } from './projects.js';
import { embeddedJsonSchema, pointerSegment } from './embedded-json-schema.js';
type Operation = {
  path: string;
  method: 'get' | 'post' | 'patch';
  output: z.ZodType;
  input?: z.ZodType;
  query?: z.ZodType;
  revision?: boolean;
  idempotency?: boolean;
  etag?: boolean;
};
export const teamAnalyticsOperations: Operation[] = [
  {
    path: '/teams/{id}/capacity',
    method: 'get',
    output: c.TeamCapacityPageSchema,
    query: c.TeamCapacityQuerySchema,
  },
  {
    path: '/teams/{id}/capacity',
    method: 'post',
    output: c.TeamCapacitySchema,
    input: c.TeamCapacityCreateSchema,
    idempotency: true,
    etag: true,
  },
  {
    path: '/teams/{id}/capacity/{capacityId}',
    method: 'patch',
    output: c.TeamCapacitySchema,
    input: c.TeamCapacityInputSchema,
    revision: true,
    etag: true,
  },
  {
    path: '/teams/{id}/workload',
    method: 'get',
    output: c.TeamWorkloadSchema,
    query: c.TeamAnalyticsQuerySchema,
  },
  {
    path: '/teams/{id}/portfolio',
    method: 'get',
    output: c.TeamPortfolioSchema,
    query: c.TeamAnalyticsQuerySchema,
  },
  {
    path: '/teams/{id}/dashboard',
    method: 'get',
    output: c.TeamDashboardSchema,
    query: c.TeamAnalyticsQuerySchema,
  },
];
export function teamAnalyticsPaths() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of teamAnalyticsOperations) {
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
    const responses: Record<string, unknown> = {
      [op.method === 'post' ? 201 : 200]: {
        description: 'Current authorized P3-03 result',
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
                (op.method === 'post' ? 201 : 200) +
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
        'teamAnalytics' + op.method + op.path.replace(/[^a-zA-Z]/g, ''),
      tags: ['team-analytics'],
      security: [{ sessionCookie: [] }],
      parameters,
      responses,
      ...(op.input
        ? {
            requestBody: {
              required: op.input !== ProjectEmptySchema,
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
