import { z } from 'zod';
import * as p from './planning.js';
import { TaskIdSchema } from './tasks.js';
import { IfMatchSchema } from './foundation.js';
export function planningPaths(): Record<string, Record<string, unknown>> {
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
        schema: json(match[1] === 'date' ? p.PlanningDateSchema : TaskIdSchema),
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
                  'Quoted owning aggregate revision; move returns the source Day revision.',
                schema: json(IfMatchSchema),
              },
            },
          }
        : {}),
    };
    paths['/api/v1/planning' + path] ??= {};
    paths['/api/v1/planning' + path]![method] = {
      operationId: 'planning_' + method + path.replace(/[^A-Za-z]/g, '_'),
      tags: ['planning'],
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
    'Personal Space owner only; strict inputs, no ownership overposting, private no-store responses. ';
  add('/days/{date}', 'post', p.DailyPlanSchema, {
    create: true,
    etag: true,
    description:
      owner +
      'Creates one empty daily plan per local date, recording the current account timezone. Existing dates return 409; reads never create plans.',
  });
  add('/days/{date}', 'get', p.DailyPlanSchema, {
    etag: true,
    description:
      owner +
      'Reads at most 100 ordered references to existing Tasks. Current scoped Task metadata/dispositions are enriched through the Task public contract. Master/deleted/terminal Tasks cannot be newly selected; existing references remain visible/removable. Masters converted after selection are exposed only as removable blockedItems metadata, never My Day Task objects. Recorded timezone never changes implicitly.',
  });
  add('/days/{date}', 'patch', p.DailyPlanSchema, {
    input: p.DayReorderSchema,
    revision: true,
    etag: true,
    description:
      owner +
      'Reorders the exact complete set of selected Task UUIDs, atomically, with the Day revision. No Task state, due date, schedule, revision or history is changed.',
  });
  add('/days/{date}/items/{taskId}', 'put', p.DailyPlanSchema, {
    input: p.SelectionPutSchema,
    revision: true,
    etag: true,
    description:
      owner +
      'Selects/refreshes an OPEN or IN_PROGRESS actionable Task using its current revision and the Day If-Match. plannedMinutes is an explicit 0–1440 allocation or null for unknown, never a Task estimate. Position defaults to existing position or append. One Task may be selected on multiple dates. Maximum 100 references/day.',
  });
  add('/days/{date}/items/{taskId}', 'delete', p.DailyPlanSchema, {
    revision: true,
    etag: true,
    description:
      owner +
      'Removes only the selection, including terminal/deleted/stale references, with the Day revision. Remaining order is compacted; Task and attachments remain intact.',
  });
  add('/days/{date}/items/{taskId}/move', 'post', p.SelectionMoveResultSchema, {
    input: p.SelectionMoveSchema,
    revision: true,
    etag: true,
    description:
      owner +
      'Explicitly moves one eligible reference between distinct dates; validates source Day If-Match, current Task revision, and destination revision (0 means still absent). No automatic due-date changes; creates an absent destination only for this successful explicit command.',
  });
  add('/weeks/{date}', 'post', p.WeeklyPlanSchema, {
    create: true,
    etag: true,
    description:
      owner +
      'Creates a unique weekly plan on the current preferred firstDayOfWeek, Sunday=0, recording timezone and weekday. A week composes seven daily plans; no weekly Task copy/backlog exists. Overlapping historical week contexts share the existing daily references.',
  });
  add('/weeks/{date}', 'get', p.WeeklyPlanSchema, {
    etag: true,
    description:
      owner +
      'Reads seven bounded daily summaries in the recorded week. Daily selection/order/removal uses the corresponding Day routes. Composed daily changes advance the Week revision. Existing weeks retain their original timezone/week-start after preference changes.',
  });
  add('/capacity/availability', 'get', p.AvailabilitySchema, {
    etag: true,
    description:
      owner +
      'Reads account-owned optional version-1 minutesByWeekday configuration (seven Sunday-first integer durations). Null means unconfigured. The revision/ETag is the shared UserSettings revision.',
  });
  add('/capacity/availability', 'put', p.AvailabilitySchema, {
    input: p.AvailabilityPutSchema,
    revision: true,
    etag: true,
    description:
      owner +
      'Configures/removes availability through the account public contract with the UserSettings revision. Each duration is 0–1440 minutes; zero differs from unknown. No existing /me/settings shape changes. No inferred workday or wall-clock TimeBlock is introduced.',
  });
  add('/capacity', 'get', p.CapacitySchema, {
    query: p.CapacityQuerySchema,
    description:
      owner +
      'Supply date or weekStartDate, never both; default is today in current account timezone. Existing plan timezone/week context is retained. Capacity sums explicit allocations for all retained references, including terminal ones until removed. Masters/missing Tasks are excluded from planned duration and reported as blockedAllocations; unresolved blocks keep remainingMinutes unknown. Unknown allocations/availability are explicit; remainingMinutes is null until both are known. Excess is advisory. Fixed durations do not silently change on DST days. No Task effort inference or calendar block exists in P1-03.',
  });
  add('/reviews', 'post', p.PlanningReviewSchema, {
    input: p.PlanningReviewCreateSchema,
    create: true,
    etag: true,
    description:
      owner +
      'Creates one private MORNING/EVENING review per date/kind or WEEKLY review per week-start. Existing plan context is retained, otherwise current preferences apply. Reflection stays solely in planning and never enters audit/outbox/logs. No Journal entity/content copy is introduced.',
  });
  add('/reviews', 'get', p.PlanningReviewPageSchema, {
    query: p.PlanningReviewQuerySchema,
    description:
      owner +
      'Scoped cursor list, default 25 maximum 100. Optional from/to must be supplied together in ascending range ≤366 days. Kind and date predicates bind the cursor; reflection remains private.',
  });
  add('/reviews/{id}', 'get', p.PlanningReviewSchema, {
    etag: true,
    description:
      owner + 'Reads the owned private review with its recorded context.',
  });
  add('/reviews/{id}', 'patch', p.PlanningReviewSchema, {
    input: p.PlanningReviewPatchSchema,
    revision: true,
    etag: true,
    description:
      owner +
      'Changes only reflection, using its review revision; dates, kind and recorded context are immutable. Audit contains opaque metadata only.',
  });
  add('/reviews/{id}', 'delete', null, {
    revision: true,
    description:
      owner +
      'Explicitly deletes the owned review with its revision, preserving metadata-only audit evidence; no undocumented trash/retention feature.',
  });
  add('/rollover/preview', 'post', p.RolloverPreviewSchema, {
    input: p.RolloverPreviewRequestSchema,
    description:
      owner +
      'Read-only suggestion from an existing source day to a later date; no destination/Task/selection writes. Includes READY/STALE/COMPLETED/DELETED/SKIPPED/CANCELED/BLOCKED/ALREADY_SELECTED classifications and source/target/settings/item/Task revisions. A stale selected Task must be explicitly refreshed before rollover.',
  });
  add('/rollover/commit', 'post', p.RolloverResultSchema, {
    input: p.RolloverCommitSchema,
    key: true,
    description:
      owner +
      'Explicit COPY or MOVE of selected snapshot items. Entire request rejects on changed plan/settings revisions; changed/ineligible Tasks are reported per item and left untouched. Destination revision 0 means still absent. MOVE removes only successful source references; COPY retains them. Maximum 100 items/day. No due/scheduled date, Task state/history, occurrence or attachment mutation. Uses atomic actor/scope/request-bound 24-hour receipts, exact replay, metadata-only audit and no worker/new event types.',
  });
  return paths;
}
