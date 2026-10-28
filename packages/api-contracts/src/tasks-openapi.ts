import { z } from 'zod';
import { CursorQuerySchema, IfMatchSchema } from './foundation.js';
import { EmptyQuerySchema } from './index.js';
import * as t from './tasks.js';

export function taskPaths(): Record<string, Record<string, unknown>> {
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
      idempotent?: boolean;
    } = {},
  ) {
    const parameters: unknown[] = [...path.matchAll(/\{(\w+)\}/g)].map(
      (match) => ({
        in: 'path',
        name: match[1],
        required: true,
        schema: json(t.TaskIdSchema),
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
    if (options.idempotent)
      parameters.push({
        in: 'header',
        name: 'Idempotency-Key',
        required: false,
        schema: { type: 'string', minLength: 1, maxLength: 128 },
      });
    for (const [name, schema] of Object.entries(options.query?.shape ?? {}))
      parameters.push({
        in: 'query',
        name,
        required: !schema.isOptional(),
        schema: json(schema),
      });
    const errors = Object.fromEntries(
      [400, 401, 403, 404, 409, 429, 503].map((status) => [
        status,
        {
          description:
            'Standard safe error. Inaccessible resources use 404; stale revisions use 409.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ApiError' },
            },
          },
        },
      ]),
    );
    const status = options.create ? '201' : output ? '200' : '204';
    paths['/api/v1' + path] ??= {};
    paths['/api/v1' + path]![method] = {
      operationId: method + path.replace(/[^A-Za-z]/g, '_'),
      tags: [path.startsWith('/labels') ? 'labels' : 'tasks'],
      security: [{ sessionCookie: [] }],
      parameters,
      description:
        'Personal Space owner only. Task changes, revision, safe immutable history and outbox events commit atomically. Checklist and association mutations use the Task ETag. New resources begin at revision 1.',
      ...(method !== 'get'
        ? {
            requestBody: {
              required: !!options.input,
              content: {
                'application/json': {
                  schema: json(options.input ?? EmptyQuerySchema),
                },
              },
            },
          }
        : {}),
      responses: {
        ...errors,
        [status]: {
          description: 'Success',
          ...(output
            ? {
                content: { 'application/json': { schema: json(output) } },
                ...(output === t.TaskSchema ||
                output === t.LabelSchema ||
                output === t.ChecklistMutationSchema
                  ? {
                      headers: {
                        ETag: {
                          description: 'Quoted current aggregate revision',
                          schema: json(IfMatchSchema),
                        },
                      },
                    }
                  : {}),
              }
            : {}),
        },
      },
    };
  }
  add('/tasks', 'post', t.TaskSchema, {
    input: t.TaskCreateSchema,
    create: true,
    idempotent: true,
  });
  // The refined query retains its authoritative shape; refinements run at runtime.
  add('/tasks', 'get', t.TaskPageSchema, { query: t.TaskListQuerySchema });
  add('/tasks/{id}', 'get', t.TaskSchema, { query: t.TaskReadQuerySchema });
  add('/tasks/{id}', 'patch', t.TaskSchema, {
    input: t.TaskPatchSchema,
    revision: true,
  });
  add('/tasks/{id}', 'delete', t.TaskSchema, { revision: true });
  for (const action of ['complete', 'reopen', 'restore'])
    add('/tasks/{id}/' + action, 'post', t.TaskSchema, { revision: true });
  add('/tasks/{id}/subtasks', 'post', t.TaskSchema, {
    input: t.SubtaskCreateSchema,
    create: true,
    idempotent: true,
  });
  add('/tasks/{id}/subtasks', 'get', t.TaskPageSchema, {
    query: t.SubtaskQuerySchema,
  });
  add('/tasks/{id}/checklist-items', 'get', t.ChecklistPageSchema, {
    query: CursorQuerySchema,
  });
  add('/tasks/{id}/checklist-items', 'post', t.ChecklistMutationSchema, {
    input: t.ChecklistCreateSchema,
    create: true,
    revision: true,
  });
  add(
    '/tasks/{id}/checklist-items/{itemId}',
    'patch',
    t.ChecklistMutationSchema,
    { input: t.ChecklistPatchSchema, revision: true },
  );
  add('/tasks/{id}/checklist-items/{itemId}', 'delete', t.TaskSchema, {
    revision: true,
  });
  add('/labels', 'get', t.LabelPageSchema, { query: CursorQuerySchema });
  add('/labels', 'post', t.LabelSchema, {
    input: t.LabelCreateSchema,
    create: true,
  });
  add('/labels/{id}', 'get', t.LabelSchema);
  add('/labels/{id}', 'patch', t.LabelSchema, {
    input: t.LabelPatchSchema,
    revision: true,
  });
  add('/labels/{id}', 'delete', null, { revision: true });
  for (const [name, key, schema] of [
    ['labels', 'labelId', t.LabelPageSchema],
    ['attachments', 'fileId', t.TaskAttachmentPageSchema],
  ] as const) {
    add('/tasks/{id}/' + name, 'get', schema, { query: CursorQuerySchema });
    for (const method of ['put', 'delete'])
      add('/tasks/{id}/' + name + '/{' + key + '}', method, t.TaskSchema, {
        revision: true,
      });
  }
  add('/tasks/{id}/history', 'get', t.TaskChangePageSchema, {
    query: CursorQuerySchema,
  });
  return paths;
}
