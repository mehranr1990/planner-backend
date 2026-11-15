import { z } from 'zod';
import * as r from './routine-execution.js';
import * as w from './working-hours.js';
import { FocusRecoveryCommandSchema, FocusViewSchema } from './focus.js';
import { PlanningDateSchema } from './planning.js';
import { IfMatchSchema } from './foundation.js';
export function personalCompletionPaths(): Record<
  string,
  Record<string, unknown>
> {
  const paths: Record<string, Record<string, unknown>> = {},
    json = (s: z.ZodType) =>
      z.toJSONSchema(s, { target: 'draft-2020-12', io: 'input' });
  function add(
    path: string,
    method: string,
    output: z.ZodType,
    input?: z.ZodType,
    query?: z.ZodObject,
    key = false,
  ) {
    const parameters: unknown[] = [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({
      in: 'path',
      name: m[1],
      required: true,
      schema: json(m[1] === 'date' ? PlanningDateSchema : z.uuid()),
    }));
    for (const [name, schema] of Object.entries(query?.shape ?? {}))
      parameters.push({
        in: 'query',
        name,
        required: !schema.isOptional(),
        schema: json(schema),
      });
    if (method !== 'get') {
      parameters.push(
        {
          in: 'header',
          name: 'Origin',
          required: true,
          schema: { type: 'string', format: 'uri' },
        },
        {
          in: 'header',
          name: 'If-Match',
          required: true,
          schema: json(IfMatchSchema),
        },
      );
      if (key)
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
    }
    const responses: Record<string, unknown> = {
      [method === 'post' ? 201 : 200]: {
        description:
          'Owned Personal result. Strong revision checks for writes; missing or foreign resources return 404.',
        content: { 'application/json': { schema: json(output) } },
      },
    };
    for (const status of [400, 401, 403, 404, 409, 429, 500, 503])
      responses[status] = {
        description:
          'Safe error. Invalid input 400, stale revision or illegal transition 409, unavailable approved policy 409.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiError' },
          },
        },
      };
    paths['/api/v1' + path] ??= {};
    paths['/api/v1' + path]![method] = {
      operationId:
        method + 'PersonalCompletion' + path.replace(/[^a-zA-Z]/g, ''),
      tags: ['personal-completion'],
      security: [{ sessionCookie: [] }],
      parameters,
      description:
        'Personal owner only. No Shared activation. Reads are bounded and do not require idempotency. Mutations return ETag. Occurrences use one stable routine/date identity; an unpersisted occurrence uses the current Routine revision. Progress reflects currently linked Habits and their real daily completion records. Schedule DST gaps are explicit; folds use the earlier instant. Capacity is advisory across configuration/calendar snapshots, unions half-open intervals, and reports UNKNOWN or DST_GAP instead of fabricated availability. Working-hours PUT replaces both weekly intervals and date exceptions; legacy availability writes clear interval configuration. Recoverable Focus commands use <=60-second heartbeat gaps, client event time between prior transition and receipt, and idempotent receipts. A stale timer requires RECOVER/finish/stop/discard; no gap is accrued. EXTEND requires minutes (5 for +5). Existing sessions use legacy routes.',
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
  }
  add('/routines/{id}/schedule', 'get', r.RoutineScheduleViewSchema);
  add(
    '/routines/{id}/schedule',
    'patch',
    r.RoutineScheduleViewSchema,
    r.RoutineScheduleUpdateSchema,
  );
  add(
    '/routines/{id}/occurrences',
    'get',
    r.RoutineExecutionPageSchema,
    undefined,
    r.RoutineOccurrenceQuerySchema,
  );
  add(
    '/routines/{id}/occurrences/{date}/execute',
    'post',
    r.RoutineExecutionSchema,
    r.RoutineExecuteSchema,
    undefined,
    true,
  );
  add('/planning/working-hours', 'get', w.WorkingHoursViewSchema);
  add(
    '/planning/working-hours',
    'put',
    w.WorkingHoursViewSchema,
    w.WorkingHoursPutSchema,
  );
  add(
    '/planning/capacity/schedule',
    'get',
    w.WorkingCapacitySchema,
    undefined,
    w.WorkingCapacityQuerySchema,
  );
  add(
    '/focus/sessions/{id}/recovery',
    'post',
    FocusViewSchema,
    FocusRecoveryCommandSchema,
    undefined,
    true,
  );
  const recovery = paths['/api/v1/focus/sessions/{id}/recovery']!.post as {
    responses: Record<string, unknown>;
  };
  recovery.responses['200'] = recovery.responses['201'];
  delete recovery.responses['201'];
  return paths;
}
