import { z } from 'zod';
import * as h from './habits.js';
import { CursorQuerySchema } from './foundation.js';
import { TaskIdSchema } from './tasks.js';
import { IfMatchSchema } from './foundation.js';
export function habitPaths(): Record<string, Record<string, unknown>> {
  const paths: Record<string, Record<string, unknown>> = {};
  const json = (schema: z.ZodType) =>
    z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' });
  function add(
    path: string,
    method: string,
    output: z.ZodType | null,
    options: {
      input?: z.ZodType;
      query?: z.ZodObject;
      revision?: boolean;
      create?: boolean;
      key?: boolean;
      etag?: boolean;
      description: string;
    },
  ) {
    const parameters: unknown[] = [...path.matchAll(/\{(\w+)\}/g)].map(
      (match) => ({
        in: 'path',
        name: match[1],
        required: true,
        schema: json(TaskIdSchema),
      }),
    );
    if (method !== 'get')
      parameters.push({
        in: 'header',
        name: 'Origin',
        required: true,
        schema: { type: 'string', format: 'uri' },
      });
    if (options.revision)
      parameters.push({
        in: 'header',
        name: 'If-Match',
        required: true,
        schema: json(IfMatchSchema),
      });
    if (options.key)
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
    for (const [name, schema] of Object.entries(options.query?.shape ?? {}))
      parameters.push({
        in: 'query',
        name,
        required: !schema.isOptional(),
        schema: json(schema),
      });
    const responses: Record<string, unknown> = {};
    for (const status of [400, 401, 403, 404, 409, 429, 503])
      responses[status] = {
        description:
          'Standard safe error; missing/foreign resources are 404; stale revisions are 409.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiError' },
          },
        },
      };
    responses[options.create ? 201 : output ? 200 : 204] = {
      description: 'Success',
      ...(output
        ? { content: { 'application/json': { schema: json(output) } } }
        : {}),
      ...(options.etag
        ? {
            headers: {
              ETag: {
                description:
                  'Quoted owning aggregate or logical entry revision.',
                schema: json(IfMatchSchema),
              },
            },
          }
        : {}),
    };
    paths['/api/v1' + path] ??= {};
    paths['/api/v1' + path]![method] = {
      operationId: 'habits_' + method + path.replace(/[^A-Za-z]/g, '_'),
      tags: ['habits'],
      security: [{ sessionCookie: [] }],
      parameters,
      description: options.description,
      ...(method !== 'get'
        ? {
            requestBody: {
              required: !!options.input,
              content: {
                'application/json': {
                  schema: options.input
                    ? json(options.input)
                    : { type: 'object', additionalProperties: false },
                },
              },
            },
          }
        : {}),
      responses,
    };
  }

  const owner =
    'Verified personal owner; strict Zod inputs and no ownership overposting. ';
  add('/habits', 'post', h.HabitSchema, {
    input: h.HabitCreateSchema,
    create: true,
    key: true,
    etag: true,
    description:
      owner +
      'Creates an independent checkbox, exact quantity or integer-second duration habit with an immutable measurement and initial versioned schedule. Omitted timezone uses the account timezone at creation; future account changes never rewrite it. WATER requires QUANTITY/ML.',
  });
  add('/habits', 'get', h.HabitPageSchema, {
    query: CursorQuerySchema,
    description:
      owner +
      'Cursor list, including retained archived habits, ordered by creation instant and UUID.',
  });
  add('/habits/{id}', 'get', h.HabitSchema, {
    etag: true,
    description:
      owner +
      'Returns current and latest schedule context; a future-start habit may have no current schedule.',
  });
  add('/habits/{id}', 'patch', h.HabitSchema, {
    input: h.HabitPatchSchema,
    revision: true,
    etag: true,
    description:
      owner +
      'Edit metadata or append a typed target/status/timezone/schedule snapshot. Past effectiveFrom requires confirmHistoricalChange:true. Edits mean that date and future dates. Prior snapshots and all entries remain. ACTIVE/PAUSED/ARCHIVED provide resume/pause/archive; no type/unit/purpose edits.',
  });
  add('/habits/{id}', 'delete', h.HabitSchema, {
    revision: true,
    etag: true,
    description:
      owner +
      'Archives effective today without deleting entries, schedules or routine links.',
  });
  add('/habits/{id}/schedules', 'get', h.HabitSchedulePageSchema, {
    query: CursorQuerySchema,
    description:
      owner +
      'Immutable configuration history, max 100/page. Statistics read at most 1000 versions per habit; edits reject further versions at that bound.',
  });
  add('/habits/{id}/entries', 'post', h.HabitEntrySchema, {
    input: h.HabitEntryCreateSchema,
    create: true,
    key: true,
    etag: true,
    description:
      owner +
      'Requires habitRevision and Idempotency-Key. LOG appends an exact measure; checkbox defaults to 1 and is unique per date. SKIP is explicit and due-day-only, neutral and cannot override completion. Defaults localDate in the saved habit timezone; records immutable server timestamp, schedule timezone and current account recordedTimezone. Historical attribution differs from recording time; future logging is rejected. Rest/paused logs remain trackable; archived habits reject new logging.',
  });
  add('/habits/{id}/entries', 'get', h.HabitEntryPageSchema, {
    query: h.HabitEntriesQuerySchema,
    description:
      owner +
      'Scoped current logical entries including void markers; optional half-open from/to range max 366 dates. Cursor binds habit and filters.',
  });
  add('/habits/{id}/entries/{entryId}', 'get', h.HabitEntrySchema, {
    etag: true,
    description:
      owner +
      'Reads a stable logical entry UUID, its current revision UUID and captured context.',
  });
  add('/habits/{id}/entries/{entryId}', 'patch', h.HabitEntrySchema, {
    input: h.HabitEntryPatchSchema,
    revision: true,
    etag: true,
    description:
      owner +
      'Requires entry If-Match and habitRevision. Appends a correction/void while preserving all earlier values/context/timestamps. Cannot change attributed date or measurement kind. Clear a skip with void:true before further logging. Historical corrections remain allowed after archive.',
  });
  add('/habits/{id}/entries/{entryId}/history', 'get', h.HabitEntryPageSchema, {
    query: CursorQuerySchema,
    description:
      owner +
      'Typed entry revision history, ordered by monotonic logical revision, including tied recording timestamps and scoped cursor.',
  });
  add('/habits/{id}/stats', 'get', h.HabitStatsSchema, {
    query: h.HabitStatsQuerySchema,
    description:
      owner +
      'Read-only recomputation over half-open from/to, max 366 dates. Explicit RANGE-scoped current/longest streak and completion numerator/denominator; no lifetime claim. Rest/pause/archive/skip dates are neutral, missed past due days break streaks, unmet asOf day is pending, later dates upcoming. asOfDate defaults to today in the saved habit zone and cannot be future. Exact contributions are recomputed after entry/schedule edits. Max 10000 current rows per calculation; RANGE_TOO_DENSE requires a narrower range.',
  });
  add('/habits/water-summary', 'get', h.WaterSummarySchema, {
    query: h.WaterSummaryQuerySchema,
    description:
      owner +
      'Exact ML totals per attributed date and WATER habit, including retained archived/rest-day history, with versioned target contexts. Optional habitId scopes one owned WATER habit. No inferred hydration goal. Bounded to 1000 habits, 10000 versions/current rows and 366 dates; RANGE_TOO_DENSE requires a narrower range or habit selection.',
  });
  add('/routines', 'post', h.RoutineSchema, {
    input: h.RoutineCreateSchema,
    create: true,
    key: true,
    etag: true,
    description:
      owner +
      'Creates an ordered association of at most 100 distinct same-space habits; never duplicates habits or logs entries.',
  });
  add('/routines', 'get', h.RoutinePageSchema, {
    query: CursorQuerySchema,
    description: owner + 'Cursor list including retained archives.',
  });
  add('/routines/{id}', 'get', h.RoutineSchema, {
    etag: true,
    description:
      owner +
      'Ordered habit associations with current paused/archived status; no automatic completion.',
  });
  add('/routines/{id}', 'patch', h.RoutineSchema, {
    input: h.RoutinePatchSchema,
    revision: true,
    etag: true,
    description:
      owner +
      'Atomically replaces/reorders associations and/or changes metadata/status. Foreign/missing habits are 404; stale revision is 409.',
  });
  add('/routines/{id}', 'delete', h.RoutineSchema, {
    revision: true,
    etag: true,
    description:
      owner +
      'Retains the archived routine and ordered links; never deletes habits or entries.',
  });
  return paths;
}
