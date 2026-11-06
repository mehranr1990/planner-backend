import { z } from 'zod';
import * as c from './index.js';
import { embeddedJsonSchema, pointerSegment } from './embedded-json-schema.js';
export function teamWorkPaths(): Record<string, Record<string, unknown>> {
  const paths: Record<string, Record<string, unknown>> = {};
  const add = (
    path: string,
    method: string,
    output: z.ZodType,
    input?: z.ZodType,
    options: {
      proof?: boolean;
      idempotency?: boolean;
      revision?: boolean;
      anonymous?: boolean;
      page?: boolean;
      etag?: boolean;
      calendar?: boolean;
      range?: boolean;
      workItems?: boolean;
    } = {},
  ) => {
    const pointer = `#/paths/${pointerSegment('/api/v1' + path)}/${method}`,
      success = method === 'post' ? 201 : 200;
    const json = (value: z.ZodType, at: string) =>
      embeddedJsonSchema(
        z.toJSONSchema(value, { target: 'draft-2020-12', io: 'input' }),
        at,
      );
    const parameters: unknown[] = [];
    for (const match of path.matchAll(/\{(\w+)\}/g))
      parameters.push({
        in: 'path',
        name: match[1],
        required: true,
        schema:
          match[1] === 'kind'
            ? { type: 'string', enum: ['phases', 'sections', 'milestones'] }
            : { type: 'string', format: 'uuid' },
      });
    if (options.page)
      parameters.push(
        {
          in: 'query',
          name: 'limit',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
        },
        {
          in: 'query',
          name: options.calendar ? 'cursor' : 'after',
          schema: {
            type: 'string',
            maxLength: options.calendar ? 8192 : 2048,
            pattern: '^[A-Za-z0-9_-]+$',
          },
        },
      );
    if (options.range)
      for (const name of ['from', 'to', 'timezone'])
        parameters.push({
          in: 'query',
          name,
          required: true,
          schema:
            name === 'timezone'
              ? { type: 'string', maxLength: 100 }
              : { type: 'string', format: 'date' },
        });
    if (options.workItems)
      parameters.push({
        in: 'query',
        name: 'planId',
        schema: { type: 'string' },
      });
    if (method !== 'get')
      parameters.push({
        in: 'header',
        name: 'Origin',
        required: true,
        schema: { type: 'string', format: 'uri' },
      });
    if (options.proof)
      parameters.push({
        in: 'header',
        name: 'X-Invitation-Proof',
        required: true,
        schema: {
          type: 'string',
          pattern: '^[A-Za-z0-9_-]{43}$',
          maxLength: 43,
        },
      });
    if (options.idempotency)
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
    if (options.revision)
      parameters.push({
        in: 'header',
        name: 'If-Match',
        required: true,
        schema: { type: 'string', pattern: '^"[1-9][0-9]*"$' },
      });
    const responses: Record<string, unknown> = {
      [success]: {
        description:
          'Authorized P3-02 result; shared activation prerequisites remain mandatory',
        headers: {
          'Cache-Control': { schema: { type: 'string', const: 'no-store' } },
          ...(!options.anonymous && !options.page && options.etag !== false
            ? { ETag: { schema: { type: 'string' } } }
            : {}),
        },
        content: {
          'application/json': {
            schema: json(
              output,
              `${pointer}/responses/${success}/content/application~1json/schema`,
            ),
          },
        },
      },
    };
    for (const code of [400, 401, 403, 404, 409, 413, 422, 429, 500, 503])
      responses[code] = {
        description:
          code === 404
            ? 'Safe absence or generic invalid invitation proof'
            : 'Safe error',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiError' },
          },
        },
      };
    paths['/api/v1' + path] ??= {};
    paths['/api/v1' + path]![method] = {
      operationId: 'teamwork' + method + path.replace(/[^a-zA-Z]/g, ''),
      tags: ['teams'],
      security: options.anonymous ? [] : [{ sessionCookie: [] }],
      parameters,
      responses,
      ...(input
        ? {
            requestBody: {
              required: input !== c.CollaborationEmptySchema,
              content: {
                'application/json': {
                  schema: json(
                    input,
                    `${pointer}/requestBody/content/application~1json/schema`,
                  ),
                },
              },
            },
          }
        : {}),
    };
  };
  add('/teams/{id}/tasks', 'get', c.SharedTaskPageSchema, undefined, {
    page: true,
    etag: false,
  });
  add(
    '/teams/{id}/tasks',
    'post',
    c.SharedTaskSchema,
    c.ProjectTaskCreateSchema,
    { idempotency: true, etag: true },
  );
  add('/teams/{id}/tasks/{sourceId}', 'get', c.SharedTaskSchema, undefined, {
    etag: true,
  });
  add(
    '/teams/{id}/tasks/{sourceId}',
    'patch',
    c.SharedTaskSchema,
    c.ProjectTaskPatchSchema,
    { idempotency: true, revision: true, etag: true },
  );
  add(
    '/teams/{id}/tasks/{sourceId}/schedule',
    'get',
    c.SharedTaskScheduleSchema,
    undefined,
    { etag: true },
  );
  add(
    '/teams/{id}/tasks/{sourceId}/schedule',
    'put',
    c.SharedTaskScheduleSchema,
    c.SharedTaskScheduleInputSchema,
    { revision: true, etag: true },
  );
  add('/teams/{id}/goals', 'get', c.SharedGoalPageSchema, undefined, {
    page: true,
    etag: false,
  });
  add(
    '/teams/{id}/goals',
    'post',
    c.SharedGoalSchema,
    c.ProjectGoalCreateSchema,
    { idempotency: true, etag: true },
  );
  add('/teams/{id}/goals/{sourceId}', 'get', c.SharedGoalSchema, undefined, {
    etag: true,
  });
  add(
    '/teams/{id}/goals/{sourceId}',
    'patch',
    c.SharedGoalSchema,
    c.ProjectGoalPatchSchema,
    { revision: true, idempotency: true, etag: true },
  );
  add(
    '/teams/{id}/goals/{goalId}/tasks/{taskId}',
    'put',
    c.SharedGoalSchema,
    c.CollaborationEmptySchema,
    { revision: true, etag: true },
  );
  add(
    '/teams/{id}/calendar/events',
    'get',
    c.TeamCalendarPageSchema,
    undefined,
    { page: true, calendar: true, etag: false },
  );
  add(
    '/teams/{id}/calendar/events',
    'post',
    c.TeamCalendarEventSchema,
    c.CalendarEventCreateSchema,
    { idempotency: true, etag: true },
  );
  add(
    '/teams/{id}/calendar/events/{eventId}',
    'get',
    c.TeamCalendarEventSchema,
    undefined,
    { etag: true },
  );
  add(
    '/teams/{id}/calendar/events/{eventId}',
    'patch',
    c.TeamCalendarEventSchema,
    c.CalendarEventPatchSchema,
    { revision: true, etag: true },
  );
  add(
    '/teams/{id}/calendar/events/{eventId}',
    'delete',
    c.TeamWorkRemovedSchema,
    c.CollaborationEmptySchema,
    { revision: true, etag: false },
  );
  add(
    '/teams/{id}/calendar/events/{eventId}/series',
    'post',
    c.TeamCalendarSeriesResultSchema,
    c.CalendarSeriesEditSchema,
    { revision: true, idempotency: true, etag: true },
  );
  add('/teams/{id}/calendar', 'get', c.CalendarViewSchema, undefined, {
    page: true,
    calendar: true,
    range: true,
    etag: false,
  });
  add('/teams/{id}/plans', 'get', c.TeamPlanPageSchema, undefined, {
    page: true,
    etag: false,
  });
  add('/teams/{id}/plans', 'post', c.TeamPlanSchema, c.TeamPlanCreateSchema, {
    idempotency: true,
    etag: true,
  });
  add('/teams/{id}/plans/{planId}', 'get', c.TeamPlanSchema, undefined, {
    etag: true,
  });
  add(
    '/teams/{id}/plans/{planId}',
    'patch',
    c.TeamPlanSchema,
    c.TeamPlanPatchSchema,
    { revision: true, etag: true },
  );
  add(
    '/teams/{id}/plans/{planId}/review',
    'put',
    c.TeamPlanSchema,
    c.TeamReviewInputSchema,
    { revision: true, etag: true },
  );
  add('/teams/{id}/work-items', 'get', c.TeamWorkItemPageSchema, undefined, {
    page: true,
    workItems: true,
    etag: false,
  });
  add(
    '/teams/{id}/work-items',
    'post',
    c.TeamWorkItemSchema,
    c.TeamWorkItemCreateSchema,
    { idempotency: true, etag: true },
  );
  add(
    '/teams/{id}/work-items/{itemId}',
    'patch',
    c.TeamWorkItemSchema,
    c.TeamWorkItemPatchSchema,
    { revision: true, etag: true },
  );
  add(
    '/teams/{id}/work-items/{itemId}',
    'delete',
    c.TeamWorkRemovedSchema,
    c.CollaborationEmptySchema,
    { revision: true, etag: false },
  );
  return paths;
}
