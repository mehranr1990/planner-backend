import { z } from 'zod';
import * as c from './insights.js';
import { IfMatchSchema } from './foundation.js';
export function insightPaths(): Record<string, Record<string, unknown>> {
  const paths: Record<string, Record<string, unknown>> = {},
    json = (s: z.ZodType) =>
      z.toJSONSchema(s, { target: 'draft-2020-12', io: 'input' });
  const add = (
    path: string,
    method: string,
    output: z.ZodType,
    input?: z.ZodType,
    query?: z.ZodType,
  ) => {
    const parameters: unknown[] = [];
    // Refinements are runtime checks; the unwrapped strict object owns query fields.
    if (query) {
      const obj = query as z.ZodObject;
      for (const [name, schema] of Object.entries(obj.shape))
        parameters.push({
          in: 'query',
          name,
          required: !(schema as z.ZodType).isOptional(),
          schema: json(schema as z.ZodType),
        });
    }
    if (method !== 'get')
      parameters.push(
        {
          in: 'header',
          name: 'Origin',
          required: true,
          schema: { type: 'string', format: 'uri' },
        },
        {
          in: 'header',
          name: 'Idempotency-Key',
          required: true,
          schema: {
            type: 'string',
            minLength: 1,
            maxLength: 128,
            pattern: '^[!-~]+$',
          },
        },
        {
          in: 'header',
          name: 'If-Match',
          required: true,
          schema: json(IfMatchSchema),
        },
      );
    const responses: Record<string, unknown> = {
      200: {
        description:
          'Owner-scoped result under ADR 0020; fresh bounded calculations and explicit definitions.',
        content: { 'application/json': { schema: json(output) } },
      },
    };
    for (const code of [400, 401, 403, 404, 409, 413, 429, 500, 503])
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
      tags: [path.startsWith('/insights') ? 'insights' : 'rewards'],
      security: [{ sessionCookie: [] }],
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
  for (const family of [
    'overview',
    'tasks',
    'habits',
    'goals',
    'time',
    'finance',
  ])
    add(
      '/insights/' + family,
      'get',
      c.InsightResponseSchema,
      undefined,
      c.InsightQuerySchema,
    );
  add('/rewards/preferences', 'get', c.RewardPreferencesSchema);
  add(
    '/rewards/preferences',
    'patch',
    c.RewardPreferencesSchema,
    c.RewardPreferencesPatchSchema,
  );
  add(
    '/rewards/progress',
    'get',
    c.RewardProgressSchema,
    undefined,
    c.RewardQuerySchema,
  );
  add('/rewards/achievements', 'get', c.AchievementsSchema);
  add(
    '/rewards/achievements/recalculate',
    'post',
    c.RewardRecalculatedSchema,
    c.RewardRecalculateSchema,
  );
  return paths;
}
