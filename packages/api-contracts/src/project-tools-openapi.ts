import { z } from 'zod';
import * as c from './project-tools.js';
import { ProjectEmptySchema, ProjectPageQuerySchema } from './projects.js';
import { embeddedJsonSchema, pointerSegment } from './embedded-json-schema.js';
type Operation = {
  path: string;
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  output: z.ZodType;
  input?: z.ZodType;
  query?: z.ZodType;
  revision?: boolean;
  idempotency?: boolean;
  etag?: boolean;
};
export const projectToolOperations: Operation[] = [
  {
    path: '/projects/{projectId}/workflows',
    method: 'get',
    output: c.WorkflowPageSchema,
    query: ProjectPageQuerySchema,
  },
  {
    path: '/projects/{projectId}/workflows',
    method: 'post',
    output: c.WorkflowVersionSchema,
    input: c.WorkflowCreateSchema,
    idempotency: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/workflows/{workflowId}/versions',
    method: 'get',
    output: c.WorkflowVersionSchema,
    query: c.ToolVersionQuerySchema,
    etag: true,
  },
  {
    path: '/projects/{projectId}/workflows/{workflowId}/versions',
    method: 'post',
    output: c.WorkflowVersionSchema,
    input: c.WorkflowVersionInputSchema,
    revision: true,
    idempotency: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/tasks/{taskId}/workflow',
    method: 'get',
    output: c.WorkflowBindingViewSchema,
    etag: true,
  },
  {
    path: '/projects/{projectId}/tasks/{taskId}/workflow',
    method: 'put',
    output: c.WorkflowBindingViewSchema,
    input: c.WorkflowBindSchema,
    revision: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/tasks/{taskId}/workflow/transitions',
    method: 'post',
    output: c.WorkflowTransitionResultSchema,
    input: c.WorkflowTransitionSchema,
    revision: true,
    idempotency: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/tasks/{taskId}/workflow/approvals',
    method: 'get',
    output: c.WorkflowApprovalPageSchema,
    query: ProjectPageQuerySchema,
  },
  {
    path: '/projects/{projectId}/tasks/{taskId}/workflow/approvals/{approvalId}/approve',
    method: 'post',
    output: c.WorkflowTransitionResultSchema,
    input: ProjectEmptySchema,
    revision: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/tasks/{taskId}/workflow/approvals/{approvalId}/reject',
    method: 'post',
    output: c.WorkflowTransitionResultSchema,
    input: ProjectEmptySchema,
    revision: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/custom-fields',
    method: 'get',
    output: c.CustomFieldPageSchema,
    query: ProjectPageQuerySchema,
  },
  {
    path: '/projects/{projectId}/custom-fields',
    method: 'post',
    output: c.CustomFieldVersionSchema,
    input: c.CustomFieldCreateSchema,
    idempotency: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/custom-fields/{fieldId}/versions',
    method: 'get',
    output: c.CustomFieldVersionSchema,
    query: c.ToolVersionQuerySchema,
    etag: true,
  },
  {
    path: '/projects/{projectId}/custom-fields/{fieldId}/versions',
    method: 'post',
    output: c.CustomFieldVersionSchema,
    input: c.CustomFieldVersionInputSchema,
    revision: true,
    idempotency: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/custom-fields/{fieldId}/deprecate',
    method: 'post',
    output: c.CustomFieldSchema,
    input: ProjectEmptySchema,
    revision: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/tasks/{taskId}/field-values',
    method: 'get',
    output: c.CustomFieldValuesSchema,
    etag: true,
  },
  {
    path: '/projects/{projectId}/tasks/{taskId}/field-values/{fieldId}',
    method: 'put',
    output: c.CustomFieldValuesSchema,
    input: c.CustomFieldSetSchema,
    revision: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/task-search',
    method: 'post',
    output: c.ToolTaskPageSchema,
    input: c.CustomFieldSearchSchema,
  },
  {
    path: '/projects/{projectId}/dependencies',
    method: 'get',
    output: c.DependencyGraphSchema,
    etag: true,
  },
  {
    path: '/projects/{projectId}/dependencies',
    method: 'post',
    output: c.DependencySchema,
    input: c.DependencyInputSchema,
    etag: true,
  },
  {
    path: '/projects/{projectId}/dependencies/{dependencyId}',
    method: 'patch',
    output: c.DependencySchema,
    input: c.DependencyPatchSchema,
    revision: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/dependencies/{dependencyId}',
    method: 'delete',
    output: c.DependencySchema,
    input: ProjectEmptySchema,
    revision: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/reschedule-previews',
    method: 'post',
    output: c.ReschedulePreviewSchema,
    input: c.ReschedulePreviewInputSchema,
    idempotency: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/reschedule-previews/{previewId}',
    method: 'get',
    output: c.ReschedulePreviewSchema,
    etag: true,
  },
  {
    path: '/projects/{projectId}/reschedule-previews/{previewId}/apply',
    method: 'post',
    output: c.ReschedulePreviewSchema,
    input: c.RescheduleApplySchema,
    revision: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/tasks/{taskId}/metadata-history',
    method: 'get',
    output: c.TaskMetadataEventPageSchema,
    query: ProjectPageQuerySchema,
  },
];
export function projectToolPaths() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of projectToolOperations) {
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
    const responses: Record<string, unknown> = {
      200: {
        description: 'Current authorized P2-05 result',
        headers: {
          'Cache-Control': { schema: { type: 'string', const: 'no-store' } },
          ...(op.etag ? { ETag: { schema: { type: 'string' } } } : {}),
        },
        content: {
          'application/json': {
            schema: schema(
              op.output,
              pointer + '/responses/200/content/application~1json/schema',
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
        'projectTool' + op.method + op.path.replace(/[^a-zA-Z]/g, ''),
      tags: ['project-tools'],
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
