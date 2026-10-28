import { z } from 'zod';
import * as g from './goals.js';
import { CursorQuerySchema } from './foundation.js';
import { TaskIdSchema } from './tasks.js';
import { IfMatchSchema } from './foundation.js';
export function goalPaths(): Record<string, Record<string, unknown>> {
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
      operationId: 'goals_' + method + path.replace(/[^A-Za-z]/g, '_'),
      tags: ['goals'],
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
    'Verified personal owner. Strict inputs; same-space nested/source references; foreign resources return 404. ';
  add('/life-areas', 'post', g.LifeAreaSchema, {
    input: g.LifeAreaCreateSchema,
    create: true,
    key: true,
    etag: true,
    description: owner + 'Create an ordered life area.',
  });
  add('/life-areas', 'get', g.LifeAreaPageSchema, {
    query: CursorQuerySchema,
    description:
      owner +
      'Creation-ordered cursor list; position is explicit organization metadata.',
  });
  add('/life-areas/{id}', 'get', g.LifeAreaSchema, {
    etag: true,
    description: owner + 'Read retained area.',
  });
  add('/life-areas/{id}', 'patch', g.LifeAreaSchema, {
    input: g.LifeAreaPatchSchema,
    revision: true,
    etag: true,
    description: owner + 'Edit title, position or ACTIVE/ARCHIVED status.',
  });
  add('/life-areas/{id}', 'delete', g.LifeAreaSchema, {
    revision: true,
    etag: true,
    description: owner + 'Archive without deleting associated Goals.',
  });
  add('/goals', 'post', g.GoalSchema, {
    input: g.GoalCreateSchema,
    create: true,
    key: true,
    etag: true,
    description:
      owner +
      'Create unified personal short/long-term goal. Saved timezone defaults from account, never silently changes. New goals start MANUAL or WEIGHTED; create a metric before selecting METRIC mode.',
  });
  add('/goals', 'get', g.GoalPageSchema, {
    query: g.GoalListQuerySchema,
    description:
      owner +
      'Scoped cursor list; referenced life area/parent filters are authorized.',
  });
  add('/goals/{id}', 'get', g.GoalSchema, {
    etag: true,
    description: owner + 'Read goal with explicit lifecycle and hierarchy.',
  });
  add('/goals/{id}', 'patch', g.GoalSchema, {
    input: g.GoalPatchSchema,
    revision: true,
    etag: true,
    description:
      owner +
      'Edit fields/status explicitly. Five-level acyclic same-space hierarchy; no implicit subgoal roll-up or automatic completion. METRIC requires a metric belonging to this goal; other modes require metricId:null. Date-only schedule is retained in saved timezone.',
  });

  add('/goals/{id}/milestones', 'get', g.GoalMilestoneListSchema, {
    description:
      owner + 'Bounded collection, max 100; returns owning goalRevision.',
  });
  add('/goals/{id}/milestones', 'post', g.GoalMilestoneMutationSchema, {
    input: g.GoalMilestoneCreateSchema,
    create: true,
    key: true,
    revision: true,
    etag: true,
    description:
      owner +
      'Create nested resource with parent If-Match, idempotency and optional explicit weight/contribution. Source links require sourceRevision. Never copies or writes source state.',
  });
  add(
    '/goals/{id}/milestones/{childId}',
    'patch',
    g.GoalMilestoneMutationSchema,
    {
      input: g.GoalMilestonePatchSchema,
      revision: true,
      etag: true,
      description:
        owner +
        'Revision-checked nested edit; If-Match and returned ETag are the owning Goal revision. Cannot retarget existing source links; unlink/relink explicitly.',
    },
  );
  add('/goals/{id}/milestones/{childId}', 'delete', g.GoalSchema, {
    revision: true,
    etag: true,
    description:
      owner +
      'Remove association/resource using owning goalRevision; historical snapshots remain. Selected metric must be deselected first.',
  });

  add('/goals/{id}/metrics', 'get', g.GoalMetricListSchema, {
    description:
      owner + 'Bounded collection, max 100; returns owning goalRevision.',
  });
  add('/goals/{id}/metrics', 'post', g.GoalMetricMutationSchema, {
    input: g.GoalMetricCreateSchema,
    create: true,
    key: true,
    revision: true,
    etag: true,
    description:
      owner +
      'Create nested resource with parent If-Match, idempotency and optional explicit weight/contribution. Source links require sourceRevision. Never copies or writes source state.',
  });
  add('/goals/{id}/metrics/{childId}', 'patch', g.GoalMetricMutationSchema, {
    input: g.GoalMetricPatchSchema,
    revision: true,
    etag: true,
    description:
      owner +
      'Revision-checked nested edit; If-Match and returned ETag are the owning Goal revision. Cannot retarget existing source links; unlink/relink explicitly.',
  });
  add('/goals/{id}/metrics/{childId}', 'delete', g.GoalSchema, {
    revision: true,
    etag: true,
    description:
      owner +
      'Remove association/resource using owning goalRevision; historical snapshots remain. Selected metric must be deselected first.',
  });

  add('/goals/{id}/links/tasks', 'get', g.GoalTaskLinkListSchema, {
    description:
      owner + 'Bounded collection, max 100; returns owning goalRevision.',
  });
  add('/goals/{id}/links/tasks', 'post', g.GoalTaskLinkMutationSchema, {
    input: g.GoalTaskLinkCreateSchema,
    create: true,
    key: true,
    revision: true,
    etag: true,
    description:
      owner +
      'Create nested resource with parent If-Match, idempotency and optional explicit weight/contribution. Source links require sourceRevision. Never copies or writes source state.',
  });
  add(
    '/goals/{id}/links/tasks/{childId}',
    'patch',
    g.GoalTaskLinkMutationSchema,
    {
      input: g.GoalTaskLinkPatchSchema,
      revision: true,
      etag: true,
      description:
        owner +
        'Revision-checked nested edit; If-Match and returned ETag are the owning Goal revision. Cannot retarget existing source links; unlink/relink explicitly.',
    },
  );
  add('/goals/{id}/links/tasks/{childId}', 'delete', g.GoalSchema, {
    revision: true,
    etag: true,
    description:
      owner +
      'Remove association/resource using owning goalRevision; historical snapshots remain. Selected metric must be deselected first.',
  });

  add('/goals/{id}/links/habits', 'get', g.GoalHabitLinkListSchema, {
    description:
      owner + 'Bounded collection, max 100; returns owning goalRevision.',
  });
  add('/goals/{id}/links/habits', 'post', g.GoalHabitLinkMutationSchema, {
    input: g.GoalHabitLinkCreateSchema,
    create: true,
    key: true,
    revision: true,
    etag: true,
    description:
      owner +
      'Create nested resource with parent If-Match, idempotency and optional explicit weight/contribution. Source links require sourceRevision. Never copies or writes source state.',
  });
  add(
    '/goals/{id}/links/habits/{childId}',
    'patch',
    g.GoalHabitLinkMutationSchema,
    {
      input: g.GoalHabitLinkPatchSchema,
      revision: true,
      etag: true,
      description:
        owner +
        'Revision-checked nested edit; If-Match and returned ETag are the owning Goal revision. Cannot retarget existing source links; unlink/relink explicitly.',
    },
  );
  add('/goals/{id}/links/habits/{childId}', 'delete', g.GoalSchema, {
    revision: true,
    etag: true,
    description:
      owner +
      'Remove association/resource using owning goalRevision; historical snapshots remain. Selected metric must be deselected first.',
  });

  add('/goals/{id}/progress', 'get', g.GoalProgressSchema, {
    description:
      owner +
      'Read-only current recomputation, ruleVersion 1. Exact rational calculations; six-place half-away-from-zero output rounding; raw percentage preserved and visible clamped 0..100. Positive weights normalized by their sum; empty weighted set gives zero/NO_SOURCES. METRIC supports increasing/decreasing targets, rejects zero denominator. Only explicitly configured sources contribute. Deleted/master/skipped/canceled Task sources are zero; habit completion uses explicit half-open window max366 dates, excludes neutral/future dates. Maximum 10000 habit evidence records; narrow/remove links when PROGRESS_TOO_DENSE.',
  });
  add('/goals/{id}/progress', 'post', g.GoalReviewMutationSchema, {
    input: g.GoalSnapshotCreateSchema,
    create: true,
    key: true,
    revision: true,
    etag: true,
    description:
      owner +
      'Explicitly persist immutable SNAPSHOT in GoalReview; increments Goal revision; captures saved timezone, source versions, ruleVersion and exact raw computation. Safe replay returns original snapshot.',
  });
  add('/goals/{id}/reviews', 'post', g.GoalReviewMutationSchema, {
    input: g.GoalReviewCreateSchema,
    create: true,
    key: true,
    revision: true,
    etag: true,
    description:
      owner +
      'Private reflection and immutable contemporaneous snapshot; reflection never appears in events/logs. No backdating or rewriting.',
  });
  add('/goals/{id}/reviews', 'get', g.GoalReviewPageSchema, {
    query: g.GoalReviewQuerySchema,
    description:
      owner +
      'Immutable history, optional SNAPSHOT/REVIEW filter, stable scoped cursor pagination.',
  });
  return paths;
}
