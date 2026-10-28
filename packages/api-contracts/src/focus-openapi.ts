import { z } from 'zod';
import * as f from './focus.js';
import { CursorQuerySchema } from './foundation.js';
import { TaskIdSchema } from './tasks.js';
import { IfMatchSchema } from './foundation.js';
export function focusPaths(): Record<string, Record<string, unknown>> {
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
      operationId: 'focus_' + method + path.replace(/[^A-Za-z]/g, '_'),
      tags: ['focus'],
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
    'Verified personal owner; strict inputs, scoped resources and source IDs; safe 404 for foreign resources. ';
  add('/focus/sessions', 'post', f.FocusViewSchema, {
    input: f.FocusCreateSchema,
    create: true,
    key: true,
    etag: true,
    description:
      owner +
      'Create IDLE STOPWATCH or finite POMODORO; saved timezone defaults from account. Optional Task needs taskRevision and an actionable ordinary Task. No Task mutation.',
  });
  add('/focus/sessions', 'get', f.FocusPageSchema, {
    query: f.FocusQuerySchema,
    description:
      owner +
      'Stable creation/logical-UUID scoped cursor list with current database-clock projections.',
  });
  add('/focus/sessions/{id}', 'get', f.FocusViewSchema, {
    etag: true,
    description:
      owner +
      'Read current state and work/break/remaining milliseconds. RUNNING continues during client/API downtime; finite schedules cap at READY_TO_FINISH but keep reservation until explicit finish/stop. Clock regressions are clamped and reported.',
  });
  add('/focus/sessions/{id}', 'patch', f.FocusViewSchema, {
    input: f.FocusPatchSchema,
    revision: true,
    etag: true,
    description:
      owner +
      'IDLE-only title/config/Task-link edit, preserving typed historical revisions and saved timezone. Cannot change mode or mutate Tasks.',
  });
  add('/focus/sessions/{id}/history', 'get', f.FocusHistoryPageSchema, {
    query: CursorQuerySchema,
    description:
      owner +
      'Immutable typed transition revisions, ordered by revision. The previous current marker is closed; recorded timestamps/configuration remain unchanged.',
  });
  for (const action of ['start', 'pause', 'resume', 'finish', 'stop'])
    add('/focus/sessions/{id}/' + action, 'post', f.FocusViewSchema, {
      input: f.FocusTransitionSchema,
      key: true,
      revision: true,
      etag: true,
      description:
        owner +
        'Explicit ' +
        action +
        ' transition, authoritative PostgreSQL clock and revision check. Duplicate actor/scope/key/body replays original result. One RUNNING/PAUSED timer per user, including across processes. FINISH requires exhausted Pomodoro schedule; STOP retains earned work as ABANDONED. Terminalization atomically creates unique TRACKED work segments excluding pauses and breaks. Max1000 revisions with a reserved terminal revision.',
    });
  add('/time-entries', 'post', f.TimeEntrySchema, {
    input: f.TimeCreateSchema,
    create: true,
    key: true,
    etag: true,
    description:
      owner +
      'Explicit MANUAL UTC interval with derived positive integer-millisecond duration, <=7 days, not future. Optional Task link needs revision. Saved timezone defaults from account. Overlaps are retained and explained by summary union/overlap totals.',
  });
  add('/time-entries', 'get', f.TimePageSchema, {
    query: f.TimeQuerySchema,
    description:
      owner +
      'Current logical entry revisions with safe Task/session filters and scope-bound cursor.',
  });
  add('/time-entries/{id}', 'get', f.TimeEntrySchema, {
    etag: true,
    description:
      owner +
      'Read current revision; stable logical UUID and immutable row UUID.',
  });
  add('/time-entries/{id}', 'patch', f.TimeEntrySchema, {
    input: f.TimePatchSchema,
    revision: true,
    etag: true,
    description:
      owner +
      'Append manual correction/void, preserving prior typed values. TRACKED entries cannot be modified independently of session evidence. Saved timezone is immutable.',
  });
  add('/time-entries/{id}', 'delete', f.TimeEntrySchema, {
    revision: true,
    etag: true,
    description:
      owner +
      'Append a VOID manual revision; never erase history or remove tracked work.',
  });
  add('/time-entries/{id}/history', 'get', f.TimePageSchema, {
    query: CursorQuerySchema,
    description:
      owner + 'Immutable entry revisions in monotonic revision order.',
  });
  add('/tasks/{id}/productivity', 'get', f.ProductivityTaskSchema, {
    etag: true,
    description:
      owner +
      'Task-owned explicit estimates and importance/urgency. Unknown flags mean UNCLASSIFIED; no priority/due-date inference. Existing Task and history response contracts stay unchanged.',
  });
  add('/tasks/{id}/productivity', 'patch', f.ProductivityTaskSchema, {
    input: f.ProductivityTaskPatchSchema,
    revision: true,
    etag: true,
    description:
      owner +
      'Update only estimatedMinutes/important/urgent through Tasks. Uses Task revision, metadata changed-key audit and task.updated outbox. No focus/Goal writes. DO/SCHEDULE/DELEGATE/ELIMINATE are classification names, not delegation actions.',
  });
  add('/productivity/summary', 'get', f.ProductivitySummarySchema, {
    query: f.ProductivityQuerySchema,
    description:
      owner +
      'Explicit half-open local dates and view timezone, max366 dates/10000 relevant records. Recorded totals use only current nonvoid TimeEntries clipped to range. Distinct work is interval union; overlap is raw minus union. Manual/tracked totals may overlap and are not additive to distinct work. Live reserved-session work is separate/uncommitted. Sessions counts use transition instants in range. Task counts/quadrants/estimates cover current actionable Tasks, exclude deleted/completed/canceled/master/skipped Tasks, and never infer unknown estimates. DST days are clipped by actual UTC boundaries; saved record context never changes. No P1-11 insights/rewards.',
  });
  return paths;
}
