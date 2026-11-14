import { z } from 'zod';
import * as c from './project-execution.js';
import { ProjectEmptySchema, ProjectPageQuerySchema } from './projects.js';
import { ToolVersionQuerySchema } from './project-tools.js';
import { embeddedJsonSchema, pointerSegment } from './embedded-json-schema.js';
type Operation = {
  path: string;
  method: 'get' | 'post' | 'put' | 'delete';
  output: z.ZodType;
  input?: z.ZodType;
  query?: z.ZodType;
  revision?: boolean;
  idempotency?: boolean;
  etag?: boolean;
};
export const projectExecutionOperations: Operation[] = [
  {
    path: '/projects/{projectId}/reports/snapshots',
    method: 'get',
    output: c.ProjectReportSnapshotPageSchema,
    query: ProjectPageQuerySchema,
  },
  {
    path: '/projects/{projectId}/change-plans/csv/inspection',
    method: 'post',
    output: c.ProjectCsvInspectionSchema,
    input: c.ProjectCsvInspectionInputSchema,
  },
  {
    path: '/projects/{projectId}/register-items',
    method: 'get',
    output: c.ProjectRegisterPageSchema,
    query: c.ProjectRegisterQuerySchema,
  },
  {
    path: '/projects/{projectId}/register-items',
    method: 'post',
    output: c.ProjectRegisterSchema,
    input: c.ProjectRegisterCreateSchema,
    idempotency: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/register-items/{itemId}',
    method: 'get',
    output: c.ProjectRegisterSchema,
    etag: true,
  },
  {
    path: '/projects/{projectId}/register-items/{itemId}',
    method: 'put',
    output: c.ProjectRegisterSchema,
    input: c.ProjectRegisterInputSchema,
    revision: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/register-items/{itemId}',
    method: 'delete',
    output: c.ProjectRegisterSchema,
    input: ProjectEmptySchema,
    revision: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/register-items/{itemId}/history',
    method: 'get',
    output: c.ProjectRegisterEventPageSchema,
    query: ProjectPageQuerySchema,
  },
  {
    path: '/projects/{projectId}/templates',
    method: 'get',
    output: c.ProjectTemplatePageSchema,
    query: ProjectPageQuerySchema,
  },
  {
    path: '/projects/{projectId}/templates',
    method: 'post',
    output: c.ProjectTemplateVersionSchema,
    input: c.ProjectTemplateCreateSchema,
    idempotency: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/templates/{templateId}/versions',
    method: 'get',
    output: c.ProjectTemplateVersionSchema,
    query: ToolVersionQuerySchema,
    etag: true,
  },
  {
    path: '/projects/{projectId}/templates/{templateId}/versions',
    method: 'post',
    output: c.ProjectTemplateVersionSchema,
    input: c.ProjectTemplateVersionInputSchema,
    revision: true,
    idempotency: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/templates/{templateId}/deprecate',
    method: 'post',
    output: c.ProjectTemplateSchema,
    input: ProjectEmptySchema,
    revision: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/templates/{templateId}/previews',
    method: 'post',
    output: c.ProjectChangePlanSchema,
    input: c.ProjectTemplatePreviewSchema,
    idempotency: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/change-plans/bulk',
    method: 'post',
    output: c.ProjectChangePlanSchema,
    input: c.ProjectBulkPreviewSchema,
    idempotency: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/change-plans/csv',
    method: 'post',
    output: c.ProjectCsvResultSchema,
    input: c.ProjectCsvPreviewSchema,
    idempotency: true,
  },
  {
    path: '/projects/{projectId}/change-plans/{planId}',
    method: 'get',
    output: c.ProjectChangePlanSchema,
    etag: true,
  },
  {
    path: '/projects/{projectId}/change-plans/{planId}/apply',
    method: 'post',
    output: c.ProjectChangePlanSchema,
    input: c.ProjectChangeApplySchema,
    revision: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/tasks/{taskId}/estimate',
    method: 'get',
    output: c.SharedEstimateSchema,
    etag: true,
  },
  {
    path: '/projects/{projectId}/tasks/{taskId}/estimate',
    method: 'put',
    output: c.SharedEstimateSchema,
    input: c.SharedEstimateInputSchema,
    revision: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/tasks/{taskId}/work-logs',
    method: 'get',
    output: c.SharedWorkLogPageSchema,
    query: ProjectPageQuerySchema,
  },
  {
    path: '/projects/{projectId}/tasks/{taskId}/work-logs',
    method: 'post',
    output: c.SharedWorkLogSchema,
    input: c.SharedWorkLogCreateSchema,
    revision: true,
    idempotency: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/tasks/{taskId}/work-logs/{logId}/void',
    method: 'post',
    output: c.SharedWorkLogSchema,
    input: ProjectEmptySchema,
    revision: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/capacity-days',
    method: 'get',
    output: c.ProjectCapacityPageSchema,
    query: c.ProjectWorkRecordsQuerySchema,
  },
  {
    path: '/projects/{projectId}/capacity-days/{recordId}',
    method: 'get',
    output: c.ProjectCapacitySchema,
    etag: true,
  },
  {
    path: '/projects/{projectId}/capacity-days',
    method: 'post',
    output: c.ProjectCapacitySchema,
    input: c.ProjectCapacityCreateSchema,
    etag: true,
  },
  {
    path: '/projects/{projectId}/capacity-days/{recordId}',
    method: 'put',
    output: c.ProjectCapacitySchema,
    input: c.ProjectCapacityInputSchema,
    revision: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/work-allocations',
    method: 'get',
    output: c.ProjectAllocationPageSchema,
    query: c.ProjectWorkRecordsQuerySchema,
  },
  {
    path: '/projects/{projectId}/work-allocations/{recordId}',
    method: 'get',
    output: c.ProjectAllocationSchema,
    etag: true,
  },
  {
    path: '/projects/{projectId}/work-allocations',
    method: 'post',
    output: c.ProjectAllocationSchema,
    input: c.ProjectAllocationCreateSchema,
    etag: true,
  },
  {
    path: '/projects/{projectId}/work-allocations/{recordId}',
    method: 'put',
    output: c.ProjectAllocationSchema,
    input: c.ProjectAllocationInputSchema,
    revision: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/workload',
    method: 'get',
    output: c.ProjectWorkloadSchema,
    query: c.ProjectWorkloadQuerySchema,
  },
  {
    path: '/projects/{projectId}/reports/current',
    method: 'get',
    output: c.ProjectReportSchema,
    query: c.ProjectReportWindowSchema,
  },
  {
    path: '/projects/{projectId}/reports/snapshots',
    method: 'post',
    output: c.ProjectReportSnapshotSchema,
    input: c.ProjectReportCreateSchema,
    idempotency: true,
  },
  {
    path: '/projects/{projectId}/reports/snapshots/{snapshotId}',
    method: 'get',
    output: c.ProjectReportSnapshotSchema,
  },
];
export function projectExecutionPaths() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of projectExecutionOperations) {
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
      for (const [name, value] of Object.entries(q.properties))
        parameters.push({
          in: 'query',
          name,
          required: q.required?.includes(name) ?? false,
          schema: value,
        });
    }
    const responses: Record<string, unknown> = {
      200: {
        description: 'Current authorized P2-06 result',
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
        'projectExecution' + op.method + op.path.replace(/[^a-zA-Z]/g, ''),
      tags: ['project-execution'],
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
