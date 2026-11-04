import { z } from 'zod';
import * as w from './work.js';
import { ProjectEmptySchema, ProjectPageQuerySchema } from './projects.js';
import { embeddedJsonSchema, pointerSegment } from './embedded-json-schema.js';
type Operation = {
  path: string;
  method: 'get' | 'post' | 'put' | 'delete';
  output: z.ZodType;
  input?: z.ZodType;
  query?: z.ZodType;
  revision?: boolean;
  idempotency?: boolean;
};
const base = '/projects/{projectId}/tasks/{taskId}',
  assign = base + '/assignments',
  item = assign + '/{assignmentId}',
  block = '/me/calendar/time-blocks/{blockId}/shared-task';
export const workOperations: Operation[] = [
  {
    path: '/projects/{projectId}/assignment-policy',
    method: 'get',
    output: w.AssignmentPolicySchema,
  },
  {
    path: assign,
    method: 'get',
    output: w.TaskAssignmentPageSchema,
    query: ProjectPageQuerySchema,
  },
  {
    path: assign,
    method: 'post',
    output: w.TaskAssignmentSchema,
    input: w.TaskAssignmentCreateSchema,
    revision: true,
    idempotency: true,
  },
  { path: item, method: 'get', output: w.TaskAssignmentPreviewSchema },
  {
    path: item + '/accept',
    method: 'post',
    output: w.TaskAssignmentSchema,
    input: ProjectEmptySchema,
    revision: true,
  },
  {
    path: item + '/decline',
    method: 'post',
    output: w.TaskAssignmentSchema,
    input: w.TaskAssignmentDeclineSchema,
    revision: true,
  },
  {
    path: item + '/revoke',
    method: 'post',
    output: w.TaskAssignmentSchema,
    input: ProjectEmptySchema,
    revision: true,
  },
  {
    path: item + '/reassign',
    method: 'post',
    output: w.TaskAssignmentSchema,
    input: w.TaskAssignmentReassignSchema,
    revision: true,
    idempotency: true,
  },
  {
    path: base + '/schedule',
    method: 'get',
    output: w.SharedTaskScheduleSchema,
  },
  {
    path: base + '/schedule',
    method: 'put',
    output: w.SharedTaskScheduleSchema,
    input: w.SharedTaskScheduleInputSchema,
    revision: true,
  },
  {
    path: '/me/work/assignments',
    method: 'get',
    output: w.TaskAssignmentPreviewPageSchema,
    query: ProjectPageQuerySchema,
  },
  {
    path: '/me/work/tasks',
    method: 'get',
    output: w.WorkTaskPageSchema,
    query: w.WorkTaskQuerySchema,
  },
  {
    path: '/me/work/goals',
    method: 'get',
    output: w.WorkGoalPageSchema,
    query: w.WorkGoalQuerySchema,
  },
  {
    path: '/me/work/notifications',
    method: 'get',
    output: w.SharedAssignmentNotificationPageSchema,
    query: ProjectPageQuerySchema,
  },
  {
    path: '/me/work/notifications/{id}/read',
    method: 'post',
    output: w.SharedAssignmentNotificationSchema,
    input: w.SharedWorkNotificationReadSchema,
    revision: true,
  },
  {
    path: '/me/calendar/overlays',
    method: 'get',
    output: w.WorkOverlayPageSchema,
    query: w.WorkOverlayQuerySchema,
  },
  { path: block, method: 'get', output: w.SharedTaskBlockViewSchema },
  {
    path: block,
    method: 'put',
    output: w.SharedTaskBlockViewSchema,
    input: w.SharedTaskBlockInputSchema,
    revision: true,
  },
  {
    path: block,
    method: 'delete',
    output: w.SharedTaskBlockViewSchema,
    input: ProjectEmptySchema,
    revision: true,
  },
];
export function workPaths() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of workOperations) {
    const path = '/api/v1' + op.path,
      pointer = '#/paths/' + pointerSegment(path) + '/' + op.method;
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
        schema: { type: 'string', format: 'uuid' },
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
      for (const [name, s] of Object.entries(q.properties))
        parameters.push({
          in: 'query',
          name,
          required: q.required?.includes(name) ?? false,
          schema: s,
        });
    }
    const success = op.method === 'post' ? 201 : 200,
      responses: Record<string, unknown> = {};
    responses[success] = {
      description: 'Current authorized P2-04 result',
      headers: {
        'Cache-Control': { schema: { type: 'string', const: 'no-store' } },
        ...(!op.query ? { ETag: { schema: { type: 'string' } } } : {}),
      },
      content: {
        'application/json': {
          schema: schema(
            op.output,
            pointer + `/responses/${success}/content/application~1json/schema`,
          ),
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
      operationId: 'work' + op.method + op.path.replace(/[^a-zA-Z]/g, ''),
      tags: ['shared-work'],
      security: [{ sessionCookie: [] }],
      parameters,
      responses,
      ...(op.input
        ? {
            requestBody: {
              required: op.input !== ProjectEmptySchema,
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
