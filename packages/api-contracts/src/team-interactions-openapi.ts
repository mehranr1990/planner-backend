import { z } from 'zod';
import * as c from './index.js';
import { ProjectEmptySchema, ProjectPageQuerySchema } from './projects.js';
import { embeddedJsonSchema, pointerSegment } from './embedded-json-schema.js';
type Operation = {
  path: string;
  method: 'get' | 'post' | 'patch';
  output: z.ZodType;
  input?: z.ZodType;
  query?: z.ZodType;
  revision?: boolean;
  idempotency?: boolean;
  etag?: boolean;
};
export const teamInteractionsOperations: Operation[] = [
  {
    path: '/teams/{id}/cases',
    method: 'get',
    output: c.TeamCasePageSchema,
    query: ProjectPageQuerySchema,
  },
  {
    path: '/teams/{id}/cases',
    method: 'post',
    output: c.TeamCaseSchema,
    input: c.TeamCaseCreateSchema,
    idempotency: true,
    etag: true,
  },
  {
    path: '/teams/{id}/cases/{caseId}',
    method: 'get',
    output: c.TeamCaseSchema,
    etag: true,
  },
  {
    path: '/teams/{id}/cases/{caseId}/entries',
    method: 'get',
    output: c.TeamCaseEntryPageSchema,
    query: ProjectPageQuerySchema,
  },
  {
    path: '/teams/{id}/cases/{caseId}/entries',
    method: 'post',
    output: c.TeamCaseSchema,
    input: c.TeamCaseEntryInputSchema,
    idempotency: true,
    revision: true,
    etag: true,
  },
  {
    path: '/teams/{id}/cases/{caseId}/reviews',
    method: 'post',
    output: c.TeamCaseSchema,
    input: c.TeamCaseReviewInputSchema,
    idempotency: true,
    revision: true,
    etag: true,
  },
  {
    path: '/teams/{id}/cases/{caseId}/disclosures',
    method: 'get',
    output: c.TeamDisclosureProposalPageSchema,
    query: ProjectPageQuerySchema,
  },
  {
    path: '/teams/{id}/cases/{caseId}/disclosures',
    method: 'post',
    output: c.TeamDisclosureProposalSchema,
    input: c.TeamDisclosureCreateSchema,
    idempotency: true,
    etag: true,
  },
  {
    path: '/teams/{id}/disclosures/{disclosureId}/review',
    method: 'post',
    output: c.TeamDisclosureProposalSchema,
    input: c.TeamDisclosureReviewSchema,
    revision: true,
    etag: true,
  },
  {
    path: '/teams/{id}/disclosures/{disclosureId}/consent',
    method: 'post',
    output: c.TeamDisclosureProposalSchema,
    input: c.TeamRecognitionConsentSchema,
    revision: true,
    etag: true,
  },
  {
    path: '/teams/{id}/disclosures/{disclosureId}/revoke',
    method: 'post',
    output: c.TeamDisclosureProposalSchema,
    input: c.CollaborationEmptySchema,
    revision: true,
    etag: true,
  },
  {
    path: '/teams/{id}/disclosures',
    method: 'get',
    output: c.TeamDisclosureSummaryPageSchema,
    query: ProjectPageQuerySchema,
  },
  {
    path: '/teams/{id}/disclosures/{disclosureId}',
    method: 'get',
    output: c.TeamDisclosureSummarySchema,
  },
  {
    path: '/teams/{id}/meetings',
    method: 'get',
    output: c.TeamMeetingPageSchema,
    query: ProjectPageQuerySchema,
  },
  {
    path: '/teams/{id}/meetings',
    method: 'post',
    output: c.TeamMeetingSchema,
    input: c.TeamMeetingCreateSchema,
    idempotency: true,
    etag: true,
  },
  {
    path: '/teams/{id}/meetings/{meetingId}',
    method: 'get',
    output: c.TeamMeetingSchema,
    etag: true,
  },
  {
    path: '/teams/{id}/meetings/{meetingId}',
    method: 'patch',
    output: c.TeamMeetingSchema,
    input: c.TeamMeetingPatchSchema,
    revision: true,
    etag: true,
  },
  {
    path: '/teams/{id}/meetings/{meetingId}/invitations',
    method: 'get',
    output: c.TeamMeetingInvitationPageSchema,
    query: ProjectPageQuerySchema,
  },
  {
    path: '/teams/{id}/meetings/{meetingId}/invitations',
    method: 'post',
    output: c.TeamMeetingInvitationSchema,
    input: c.TeamMeetingInvitationCreateSchema,
    idempotency: true,
    revision: true,
    etag: true,
  },
  {
    path: '/teams/{id}/meetings/{meetingId}/invitations/{invitationId}/respond',
    method: 'post',
    output: c.TeamMeetingInvitationSchema,
    input: c.TeamMeetingInvitationResponseSchema,
    revision: true,
    etag: true,
  },
  {
    path: '/teams/{id}/meetings/{meetingId}/invitations/{invitationId}/revoke',
    method: 'post',
    output: c.TeamMeetingInvitationSchema,
    input: c.CollaborationEmptySchema,
    revision: true,
    etag: true,
  },
];
export function teamInteractionsPaths() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of teamInteractionsOperations) {
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
      [op.method === 'post' ? 201 : 200]: {
        description: 'Current authorized P3-04 result',
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
                (op.method === 'post' ? 201 : 200) +
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
        'teamInteractions' + op.method + op.path.replace(/[^a-zA-Z]/g, ''),
      tags: ['team-interactions'],
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
