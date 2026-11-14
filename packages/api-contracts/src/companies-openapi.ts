import { z } from 'zod';
import * as c from './index.js';
import { ProjectEmptySchema } from './projects.js';
import { embeddedJsonSchema, pointerSegment } from './embedded-json-schema.js';
type Operation = {
  path: string;
  method: 'get' | 'post' | 'patch' | 'put';
  output: z.ZodType;
  input?: z.ZodType;
  query?: z.ZodType;
  revision?: boolean;
  idempotency?: boolean;
  etag?: boolean;
  status200?: boolean;
  proof?: boolean;
  policyTag?: boolean;
  public?: boolean;
};
export const companyOperations: Operation[] = [
  {
    path: '/company-invitations',
    method: 'get',
    output: c.PendingInvitationPageSchema,
    query: c.CompanyPageQuerySchema,
  },
  {
    path: '/companies/{id}/contexts/{scopeId}/invitations',
    method: 'get',
    output: c.CompanyInvitationPageSchema,
    query: c.CompanyPageQuerySchema,
  },
  {
    path: '/companies/{id}/contexts/{scopeId}/access/me',
    method: 'get',
    output: c.ScopeAccessMeSchema,
  },
  {
    path: '/companies',
    method: 'post',
    output: c.CompanySchema,
    input: c.CompanyCreateSchema,
    idempotency: true,
    etag: true,
  },
  {
    path: '/companies',
    method: 'get',
    output: c.CompanyPageSchema,
    query: c.CompanyPageQuerySchema,
  },
  {
    path: '/companies/{id}',
    method: 'get',
    output: c.CompanySchema,
    etag: true,
  },
  {
    path: '/companies/{id}',
    method: 'patch',
    output: c.CompanySchema,
    input: c.CompanyPatchSchema,
    revision: true,
    etag: true,
  },
  {
    path: '/companies/{id}/departments',
    method: 'post',
    output: c.CompanyContextSchema,
    input: c.CompanyContextCreateSchema,
    idempotency: true,
    etag: true,
  },
  {
    path: '/companies/{id}/departments',
    method: 'get',
    output: c.CompanyContextPageSchema,
    query: c.CompanyPageQuerySchema,
  },
  {
    path: '/companies/{id}/departments/{departmentId}',
    method: 'get',
    output: c.CompanyContextSchema,
    etag: true,
  },
  {
    path: '/companies/{id}/departments/{departmentId}',
    method: 'patch',
    output: c.CompanyContextSchema,
    input: c.CompanyPatchSchema,
    revision: true,
    etag: true,
  },
  {
    path: '/companies/{id}/departments/{departmentId}/units',
    method: 'post',
    output: c.CompanyContextSchema,
    input: c.CompanyContextCreateSchema,
    idempotency: true,
    etag: true,
  },
  {
    path: '/companies/{id}/departments/{departmentId}/units',
    method: 'get',
    output: c.CompanyContextPageSchema,
    query: c.CompanyPageQuerySchema,
  },
  {
    path: '/companies/{id}/units/{unitId}',
    method: 'get',
    output: c.CompanyContextSchema,
    etag: true,
  },
  {
    path: '/companies/{id}/units/{unitId}',
    method: 'patch',
    output: c.CompanyContextSchema,
    input: c.CompanyPatchSchema,
    revision: true,
    etag: true,
  },
  {
    path: '/companies/{id}/contexts/{scopeId}/members',
    method: 'get',
    output: c.CompanyMembershipPageSchema,
    query: c.CompanyPageQuerySchema,
  },
  {
    path: '/companies/{id}/contexts/{scopeId}/invitations',
    method: 'post',
    output: c.CompanyInvitationDeliverySchema,
    input: c.CompanyInvitationCreateSchema,
    idempotency: true,
  },
  {
    path: '/companies/{id}/contexts/{scopeId}/invitations/{invitationId}',
    method: 'get',
    output: c.CompanyInvitationSchema,
    etag: true,
  },
  {
    path: '/companies/{id}/contexts/{scopeId}/invitations/{invitationId}/revoke',
    method: 'post',
    output: c.CompanyInvitationSchema,
    input: c.CollaborationEmptySchema,
    revision: true,
    etag: true,
    status200: true,
  },
  {
    path: '/companies/{id}/contexts/{scopeId}/members/{accessId}',
    method: 'patch',
    output: c.CompanyMembershipSchema,
    input: c.CompanyMembershipChangeSchema,
    revision: true,
    etag: true,
  },
  {
    path: '/companies/{id}/contexts/{scopeId}/leave',
    method: 'post',
    output: c.CompanyLeaveResultSchema,
    input: c.CollaborationEmptySchema,
    revision: true,
    etag: true,
    status200: true,
  },
  {
    path: '/companies/{id}/contexts/{scopeId}/policy',
    method: 'get',
    output: c.CompanyEffectivePolicySchema,
    policyTag: true,
  },
  {
    path: '/companies/{id}/contexts/{scopeId}/policy',
    method: 'put',
    output: c.CompanyEffectivePolicySchema,
    input: c.CompanyPolicyPublishSchema,
    revision: true,
    policyTag: true,
  },
  {
    path: '/company-invitations/preview',
    method: 'get',
    output: c.CompanyInvitationPreviewSchema,
    proof: true,
    public: true,
  },
  {
    path: '/company-invitations/{invitationId}/accept',
    method: 'post',
    output: c.CompanyInvitationDecisionSchema,
    input: c.CollaborationEmptySchema,
    revision: true,
    proof: true,
    status200: true,
  },
  {
    path: '/company-invitations/{invitationId}/decline',
    method: 'post',
    output: c.CompanyInvitationDecisionSchema,
    input: c.CollaborationEmptySchema,
    revision: true,
    proof: true,
    status200: true,
  },
];
export function companyPaths(
  operations = companyOperations,
  description = 'Current authorized P4-01 result',
) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of operations) {
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
    if (op.proof)
      parameters.push({
        in: 'header',
        name: 'X-Invitation-Proof',
        required: true,
        schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' },
      });
    const responses: Record<string, unknown> = {
      [op.method === 'post' && !op.status200 ? 201 : 200]: {
        description,
        headers: {
          'Cache-Control': { schema: { type: 'string', const: 'no-store' } },
          ...(op.etag || op.policyTag
            ? { ETag: { schema: { type: 'string' } } }
            : {}),
        },
        content: {
          'application/json': {
            schema: schema(
              op.output,
              pointer +
                '/responses/' +
                (op.method === 'post' && !op.status200 ? 201 : 200) +
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
      operationId: 'company' + op.method + op.path.replace(/[^a-zA-Z]/g, ''),
      tags: ['companies'],
      security: op.public ? [] : [{ sessionCookie: [] }],
      parameters,
      responses,
      ...(op.input
        ? {
            requestBody: {
              required:
                op.input !== ProjectEmptySchema &&
                op.input !== c.CollaborationEmptySchema,
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
