import { z } from 'zod';
import * as c from './index.js';
import { embeddedJsonSchema, pointerSegment } from './embedded-json-schema.js';
type Operation = {
  path: string;
  method: 'get' | 'post' | 'put' | 'patch';
  output: z.ZodType;
  input?: z.ZodType;
  query?: z.ZodType;
  revision?: boolean;
  idempotency?: boolean;
  etag?: boolean;
  status?: 200 | 201;
};
/** Company Backend completion (2026-11-13): C-M1 currency, C-M3 directory/KPIs, C-M4 resource approvals and association summaries. */
export const companyCompletionOperations: Operation[] = [
  {
    path: '/companies/{id}/settings',
    method: 'get',
    output: c.CompanySettingsSchema,
    etag: true,
  },
  {
    path: '/companies/{id}/settings/currency',
    method: 'put',
    output: c.CompanySettingsSchema,
    input: c.CompanyCurrencyInputSchema,
    revision: true,
    etag: true,
  },
  {
    path: '/companies/{id}/contexts/{scopeId}/directory',
    method: 'get',
    output: c.CompanyDirectoryPageSchema,
    query: c.CompanyStaffPageQuerySchema,
  },
  {
    path: '/companies/{id}/contexts/{scopeId}/staff-profiles/{profileId}/work-details',
    method: 'put',
    output: c.CompanyWorkDetailsSchema,
    input: c.CompanyWorkDetailsInputSchema,
    revision: true,
    etag: true,
  },
  {
    path: '/companies/{id}/contexts/{scopeId}/reports/kpis',
    method: 'get',
    output: c.CompanyKpiReportSchema,
    query: c.CompanyReportQuerySchema,
  },
  {
    path: '/companies/{id}/contexts/{scopeId}/association-summaries',
    method: 'get',
    output: c.CompanyAssociationSummaryPageSchema,
    query: c.CompanyAssociationQuerySchema,
  },
  {
    path: '/companies/{id}/contexts/{scopeId}/association-candidates',
    method: 'get',
    output: c.CompanyAttachCandidatePageSchema,
  },
  {
    path: '/companies/{id}/contexts/{scopeId}/resource-types',
    method: 'get',
    output: c.CompanyResourceTypePageSchema,
    query: c.CompanyStaffPageQuerySchema,
  },
  {
    path: '/companies/{id}/contexts/{scopeId}/resource-types',
    method: 'post',
    output: c.CompanyResourceTypeSchema,
    input: c.CompanyResourceTypeCreateSchema,
    idempotency: true,
    etag: true,
  },
  {
    path: '/companies/{id}/contexts/{scopeId}/resource-types/{typeId}',
    method: 'patch',
    output: c.CompanyResourceTypeSchema,
    input: c.CompanyResourceTypePatchSchema,
    revision: true,
    etag: true,
  },
  {
    path: '/companies/{id}/contexts/{scopeId}/resources/{resourceId}/type',
    method: 'put',
    output: c.CompanyResourceSchema,
    input: c.CompanyResourceTypeAssignSchema,
    revision: true,
    etag: true,
  },
  {
    path: '/companies/{id}/contexts/{scopeId}/resource-workflows',
    method: 'get',
    output: c.CompanyResourceWorkflowPageSchema,
    query: c.CompanyResourceWorkflowQuerySchema,
  },
  {
    path: '/companies/{id}/contexts/{scopeId}/resource-workflows',
    method: 'post',
    output: c.CompanyResourceWorkflowSchema,
    input: c.CompanyResourceWorkflowCreateSchema,
    idempotency: true,
    etag: true,
  },
  {
    path: '/companies/{id}/contexts/{scopeId}/resource-workflows/{versionId}',
    method: 'get',
    output: c.CompanyResourceWorkflowSchema,
    etag: true,
  },
  {
    path: '/companies/{id}/contexts/{scopeId}/resource-workflows/{versionId}',
    method: 'patch',
    output: c.CompanyResourceWorkflowSchema,
    input: c.CompanyResourceWorkflowPatchSchema,
    revision: true,
    etag: true,
  },
  {
    path: '/companies/{id}/contexts/{scopeId}/resource-workflows/{versionId}/publish',
    method: 'post',
    output: c.CompanyResourceWorkflowSchema,
    input: c.CollaborationEmptySchema,
    revision: true,
    etag: true,
    status: 200,
  },
  {
    path: '/companies/{id}/contexts/{scopeId}/resource-workflows/{versionId}/archive',
    method: 'post',
    output: c.CompanyResourceWorkflowSchema,
    input: c.CollaborationEmptySchema,
    revision: true,
    etag: true,
    status: 200,
  },
  {
    path: '/companies/{id}/contexts/{scopeId}/resource-requests',
    method: 'get',
    output: c.CompanyResourceRequestPageSchema,
    query: c.CompanyResourceRequestQuerySchema,
  },
  {
    path: '/companies/{id}/contexts/{scopeId}/resources/{resourceId}/requests',
    method: 'post',
    output: c.CompanyResourceRequestSchema,
    input: c.CompanyResourceRequestCreateSchema,
    idempotency: true,
    etag: true,
  },
  {
    path: '/companies/{id}/contexts/{scopeId}/resource-requests/{requestId}',
    method: 'get',
    output: c.CompanyResourceRequestSchema,
    etag: true,
  },
  {
    path: '/companies/{id}/contexts/{scopeId}/resource-requests/{requestId}/history',
    method: 'get',
    output: c.CompanyResourceRequestHistorySchema,
  },
  {
    path: '/companies/{id}/contexts/{scopeId}/resource-requests/{requestId}/decision',
    method: 'post',
    output: c.CompanyResourceRequestSchema,
    input: c.CompanyResourceRequestDecisionSchema,
    revision: true,
    etag: true,
    status: 200,
  },
  {
    path: '/companies/{id}/contexts/{scopeId}/resource-requests/{requestId}/withdraw',
    method: 'post',
    output: c.CompanyResourceRequestSchema,
    input: c.CollaborationEmptySchema,
    revision: true,
    etag: true,
    status: 200,
  },
];
export function companyCompletionPaths() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of companyCompletionOperations) {
    const path = '/api/v1' + op.path,
      pointer = '#/paths/' + pointerSegment(path) + '/' + op.method,
      status = op.status ?? (op.method === 'post' ? 201 : 200);
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
        schema:
          m[1] === 'period'
            ? { type: 'string', format: 'date' }
            : { type: 'string', format: 'uuid' },
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
      [status]: {
        description: 'Current authorized Company completion result',
        headers: {
          'Cache-Control': { schema: { type: 'string', const: 'no-store' } },
          ...(op.etag ? { ETag: { schema: { type: 'string' } } } : {}),
        },
        content: {
          'application/json': {
            schema: schema(
              op.output,
              pointer +
                '/responses/' +
                status +
                '/content/application~1json/schema',
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
        'companyCompletion' + op.method + op.path.replace(/[^a-zA-Z]/g, ''),
      tags: ['company-completion'],
      security: [{ sessionCookie: [] }],
      parameters,
      responses,
      ...(op.input
        ? {
            requestBody: {
              required: op.input !== c.CollaborationEmptySchema,
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
