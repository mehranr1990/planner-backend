import { z } from 'zod';
import * as t from './task-tools.js';
import * as r from './recurrence.js';
import { TaskIdSchema, TaskSchema, TaskPageSchema } from './tasks.js';
import { CursorQuerySchema, IfMatchSchema } from './foundation.js';

export function taskToolPaths(): Record<string, Record<string, unknown>> {
  const paths: Record<string, Record<string, unknown>> = {};
  const json = (schema: z.ZodType) =>
    z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' });
  function add(
    path: string,
    method: string,
    output: z.ZodType | null,
    options: {
      input?: z.ZodType;
      page?: boolean;
      revision?: boolean;
      key?: boolean;
      create?: boolean;
      description?: string;
    } = {},
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
    if (options.page)
      for (const [name, schema] of Object.entries(CursorQuerySchema.shape))
        parameters.push({
          in: 'query',
          name,
          required: false,
          schema: json(schema),
        });
    const responses: Record<string, unknown> = {};
    for (const status of [400, 401, 403, 404, 409, 429, 503])
      responses[status] = {
        description:
          'Safe standard error; inaccessible IDs return 404 and stale revisions return 409.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiError' },
          },
        },
      };
    const status = options.create ? 201 : output ? 200 : 204;
    responses[status] = {
      description: 'Success',
      ...(output
        ? { content: { 'application/json': { schema: json(output) } } }
        : {}),
      ...(output &&
      [
        t.TaskTemplateSchema,
        t.SavedTaskFilterSchema,
        r.TaskRecurrenceSchema,
        r.TaskOccurrenceSchema,
        r.RecurrenceEditResultSchema,
        TaskSchema,
      ].includes(output as typeof TaskSchema)
        ? {
            headers: {
              ETag: {
                schema: json(IfMatchSchema),
                description: 'Quoted aggregate revision',
              },
            },
          }
        : {}),
    };
    paths['/api/v1' + path] ??= {};
    paths['/api/v1' + path]![method] = {
      operationId: method + path.replace(/[^A-Za-z]/g, '_'),
      tags: ['tasks'],
      security: [{ sessionCookie: [] }],
      parameters,
      description:
        options.description ??
        'Personal Space owner only; strict validation and revision preconditions. All changes and history/outbox consequences commit atomically.',
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
  for (const [path, schema, create, patch, page] of [
    [
      '/task-templates',
      t.TaskTemplateSchema,
      t.TaskTemplateCreateSchema,
      t.TaskTemplatePatchSchema,
      t.TaskTemplatePageSchema,
    ],
    [
      '/saved-task-filters',
      t.SavedTaskFilterSchema,
      t.SavedTaskFilterCreateSchema,
      t.SavedTaskFilterPatchSchema,
      t.SavedTaskFilterPageSchema,
    ],
  ] as const) {
    add(path, 'post', schema, { input: create, create: true });
    add(path, 'get', page, { page: true });
    add(path + '/{id}', 'get', schema);
    add(path + '/{id}', 'patch', schema, { input: patch, revision: true });
    add(path + '/{id}', 'delete', null, { revision: true });
  }
  add('/task-templates/{id}/apply', 'post', TaskSchema, {
    input: t.TaskTemplateApplySchema,
    key: true,
    create: true,
    description:
      'Copies safe scalar values and unchecked checklist items into a new OPEN Task. No parent, label or file references. Template revision is checked atomically; later template edits do not change existing Tasks. Actor/scope/request-bound idempotency lasts 24 hours.',
  });
  add('/saved-task-filters/{id}/tasks', 'get', TaskPageSchema, {
    page: true,
    description:
      'Executes the normalized version-1 conjunction of existing Task predicates. Scoped references are reauthorized every time. Master Tasks are excluded. No SQL, custom operators or pagination stored in the DSL.',
  });
  add('/tasks/bulk', 'post', t.BulkTaskResponseSchema, {
    input: t.BulkTaskRequestSchema,
    key: true,
    description:
      '1–100 ordered independent items: PATCH, COMPLETE, REOPEN, DELETE, RESTORE, ADD_LABEL, REMOVE_LABEL. Each needs Task id and revision. Returns APPLIED or safe REJECTED per item, plus counts; malformed items do not reject valid siblings. Each result and side effects are durably deduplicated for 24 hours, scoped to actor and full request. Unexpected service failures may interrupt processing; retry the same request/key to resume.',
  });
  add('/task-recurrences', 'post', r.TaskRecurrenceSchema, {
    input: r.TaskRecurrenceCreateSchema,
    create: true,
    description:
      'Converts an existing OPEN standalone Task into a non-actionable master. Its identity/history are preserved; ordinary task lists exclude it. The source Task revision is mandatory. Policies: DST gap SKIPPED/DST_GAP without Task; fold earlier UTC; short months/non-leap February 29 skipped.',
  });
  add('/task-recurrences', 'get', r.TaskRecurrencePageSchema, { page: true });
  add('/task-recurrences/{id}', 'get', r.TaskRecurrenceSchema);
  add('/task-recurrences/{id}', 'patch', r.RecurrenceEditResultSchema, {
    input: r.RecurrenceEditSchema,
    revision: true,
    description:
      'THIS_OCCURRENCE edits only a pending occurrence using occurrence and Task revisions; THIS_AND_FUTURE creates an audited linked successor at the selected local date; ENTIRE_SERIES updates nonterminal non-exception occurrences in this segment. Terminal history remains unchanged. Original recurrence identity time stays stable across schedule edits. Splits retain terminal dates across lineage.',
  });
  add('/task-recurrences/{id}', 'delete', r.TaskRecurrenceSchema, {
    revision: true,
    description:
      'Retires the series and cancels pending occurrences with Task history; retains all series and terminal history.',
  });
  add('/task-recurrences/{id}/catch-up', 'post', r.CatchUpResultSchema, {
    input: r.CatchUpSchema,
    description:
      'Explicit generation only; no worker. Each request scans at most 366 local dates and returns at most 100 occurrences. Progress persists atomically. Follow the actor/scope/series/revision/through-bound cursor; retries and concurrent generation cannot duplicate identities. Missed valid occurrences stay PENDING. Occurrence Tasks copy master title/description/priority, unchecked checklist and labels; dueAt is the resolved instant, scheduledDate is series-local date. Files are not copied. Exclusions produce no Task. Changing account timezone never changes series timezone.',
  });
  add('/task-recurrences/{id}/occurrences', 'get', r.TaskOccurrencePageSchema, {
    page: true,
  });
  add('/task-occurrences/{id}', 'get', r.TaskOccurrenceSchema);
  for (const action of ['complete', 'skip', 'cancel'])
    add('/task-occurrences/{id}/' + action, 'post', r.TaskOccurrenceSchema, {
      input: r.OccurrenceActionSchema,
      revision: true,
      description:
        'Only a PENDING actionable occurrence; requires its revision and the linked Task revision. Task/occurrence/history/outbox update atomically. Skip never completes a Task. Master and other occurrences remain independent.',
    });
  return paths;
}
