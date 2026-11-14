import { z } from 'zod';
import * as c from './index.js';
import { ProjectPageQuerySchema } from './projects.js';
import { embeddedJsonSchema, pointerSegment } from './embedded-json-schema.js';
export type Operation = {
  path: string;
  method: 'get' | 'post' | 'put' | 'patch';
  output: z.ZodType;
  input?: z.ZodType;
  query?: z.ZodType;
  revision?: boolean;
  idempotency?: boolean;
  etag?: boolean;
  status?: 200 | 201;
};
export const teamCompletionOperations: Operation[] = [
  {
    path: '/teams/{id}/settings',
    method: 'get',
    output: c.TeamSettingsSchema,
    etag: true,
  },
  {
    path: '/teams/{id}/settings',
    method: 'patch',
    output: c.TeamSettingsSchema,
    input: c.TeamSettingsPatchSchema,
    revision: true,
    etag: true,
  },
  {
    path: '/teams/{id}/presence',
    method: 'get',
    output: c.TeamPresencePageSchema,
    query: ProjectPageQuerySchema,
  },
  {
    path: '/teams/{id}/presence/me',
    method: 'get',
    output: c.TeamPresenceSchema,
    etag: true,
  },
  {
    path: '/teams/{id}/presence/me',
    method: 'put',
    output: c.TeamPresenceSchema,
    input: c.TeamPresenceInputSchema,
    revision: true,
    etag: true,
  },
  {
    path: '/teams/{id}/checkins/{period}',
    method: 'get',
    output: c.TeamCheckinWeekSchema,
  },
  {
    path: '/teams/{id}/checkins/{period}/reply',
    method: 'put',
    output: c.TeamCheckinReplySchema,
    input: c.TeamCheckinReplyInputSchema,
    revision: true,
    etag: true,
  },
  {
    path: '/teams/{id}/checkins/{period}/replies/{replyId}/comments',
    method: 'post',
    output: c.TeamCheckinCommentSchema,
    input: c.TeamCheckinCommentInputSchema,
    idempotency: true,
  },
  {
    path: '/teams/{id}/task-planning',
    method: 'get',
    output: c.TeamTaskPlanningPageSchema,
    query: ProjectPageQuerySchema,
  },
  {
    path: '/teams/{id}/tasks/{sourceId}/board-state',
    method: 'put',
    output: c.TeamTaskPlanningSchema,
    input: c.TeamBoardStateInputSchema,
    revision: true,
    etag: true,
  },
  {
    path: '/teams/{id}/tasks/{sourceId}/estimate',
    method: 'put',
    output: c.TeamTaskPlanningSchema,
    input: c.TeamTaskEstimateInputSchema,
    revision: true,
    etag: true,
  },
  {
    path: '/teams/{id}/plans/{planId}/summary',
    method: 'get',
    output: c.TeamPlanSummarySchema,
    etag: true,
  },
  {
    path: '/teams/{id}/plans/{planId}/planning',
    method: 'put',
    output: c.TeamPlanSummarySchema,
    input: c.TeamPlanPlanningInputSchema,
    revision: true,
    etag: true,
  },
  {
    path: '/teams/{id}/plans/{planId}/items/{itemId}/carry-over',
    method: 'post',
    output: c.TeamPlanSummarySchema,
    input: c.TeamCarryOverInputSchema,
    revision: true,
    etag: true,
  },
  {
    path: '/teams/{id}/backlog/order',
    method: 'put',
    output: c.TeamBacklogOrderSchema,
    input: c.TeamBacklogOrderInputSchema,
  },
  {
    path: '/teams/{id}/thanks',
    method: 'get',
    output: c.TeamThanksPageSchema,
    query: ProjectPageQuerySchema,
  },
  {
    path: '/teams/{id}/thanks',
    method: 'post',
    output: c.TeamThanksSchema,
    input: c.TeamThanksCreateSchema,
    idempotency: true,
  },
  {
    path: '/teams/{id}/thanks/{thanksId}/hidden',
    method: 'put',
    output: c.TeamThanksSchema,
    input: c.TeamThanksHiddenInputSchema,
  },
  {
    path: '/teams/{id}/thanks/{thanksId}/remove',
    method: 'post',
    output: c.TeamThanksRemovedSchema,
    input: c.CollaborationEmptySchema,
  },
  {
    path: '/teams/{id}/feedback',
    method: 'get',
    output: c.TeamFeedbackInboxSchema,
  },
  {
    path: '/teams/{id}/feedback/requests',
    method: 'post',
    output: c.TeamFeedbackRequestSchema,
    input: c.TeamFeedbackRequestCreateSchema,
    idempotency: true,
  },
  {
    path: '/teams/{id}/feedback/notes',
    method: 'post',
    output: c.TeamFeedbackNoteSchema,
    input: c.TeamFeedbackNoteCreateSchema,
    idempotency: true,
  },
  {
    path: '/teams/{id}/activity',
    method: 'get',
    output: c.TeamActivityPageSchema,
    query: c.TeamActivityQuerySchema,
  },
];
export function teamCompletionPaths(
  operations: Operation[] = teamCompletionOperations,
  options = {
    prefix: 'teamCompletion',
    tag: 'team-completion',
    description: 'Current authorized Team completion result',
  },
) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of operations) {
    const path = '/api/v1' + op.path,
      pointer = '#/paths/' + pointerSegment(path) + '/' + op.method,
      status = op.status ?? (op.method === 'post' ? 201 : 200);
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
        schema:
          m[1] === 'period'
            ? { type: 'string', format: 'date' }
            : { type: 'string', format: 'uuid' },
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
      [status]: {
        description: options.description,
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
                status +
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
        options.prefix + op.method + op.path.replace(/[^a-zA-Z]/g, ''),
      tags: [options.tag],
      security: [{ sessionCookie: [] }],
      parameters,
      responses,
      ...(op.input
        ? {
            requestBody: {
              required: op.input !== c.CollaborationEmptySchema,
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
