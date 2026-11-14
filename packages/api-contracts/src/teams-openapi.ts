import { z } from 'zod';
import * as c from './teams.js';
import * as shared from './collaboration.js';
import {
  ScopeAccessMeSchema,
  PendingInvitationPageSchema,
} from './scope-access.js';
import { embeddedJsonSchema, pointerSegment } from './embedded-json-schema.js';
export function teamPaths(): Record<string, Record<string, unknown>> {
  const paths: Record<string, Record<string, unknown>> = {};
  const add = (
    path: string,
    method: string,
    output: z.ZodType,
    input?: z.ZodType,
    options: {
      proof?: boolean;
      idempotency?: boolean;
      revision?: boolean;
      anonymous?: boolean;
      page?: boolean;
      etag?: boolean;
    } = {},
  ) => {
    const pointer = `#/paths/${pointerSegment('/api/v1' + path)}/${method}`,
      success = method === 'post' ? 201 : 200;
    const json = (value: z.ZodType, at: string) =>
      embeddedJsonSchema(
        z.toJSONSchema(value, { target: 'draft-2020-12', io: 'input' }),
        at,
      );
    const parameters: unknown[] = [];
    for (const match of path.matchAll(/\{(\w+)\}/g))
      parameters.push({
        in: 'path',
        name: match[1],
        required: true,
        schema:
          match[1] === 'kind'
            ? { type: 'string', enum: ['phases', 'sections', 'milestones'] }
            : { type: 'string', format: 'uuid' },
      });
    if (options.page)
      parameters.push(
        {
          in: 'query',
          name: 'limit',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
        },
        {
          in: 'query',
          name: 'after',
          schema: {
            type: 'string',
            maxLength: 2048,
            pattern: '^[A-Za-z0-9_-]+$',
          },
        },
      );
    if (method !== 'get')
      parameters.push({
        in: 'header',
        name: 'Origin',
        required: true,
        schema: { type: 'string', format: 'uri' },
      });
    if (options.proof)
      parameters.push({
        in: 'header',
        name: 'X-Invitation-Proof',
        required: true,
        schema: {
          type: 'string',
          pattern: '^[A-Za-z0-9_-]{43}$',
          maxLength: 43,
        },
      });
    if (options.idempotency)
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
    if (options.revision)
      parameters.push({
        in: 'header',
        name: 'If-Match',
        required: true,
        schema: { type: 'string', pattern: '^"[1-9][0-9]*"$' },
      });
    const responses: Record<string, unknown> = {
      [success]: {
        description:
          'Authorized P3-01 result; shared activation prerequisites remain mandatory',
        headers: {
          'Cache-Control': { schema: { type: 'string', const: 'no-store' } },
          ...(!options.anonymous && !options.page && options.etag !== false
            ? { ETag: { schema: { type: 'string' } } }
            : {}),
        },
        content: {
          'application/json': {
            schema: json(
              output,
              `${pointer}/responses/${success}/content/application~1json/schema`,
            ),
          },
        },
      },
    };
    for (const code of [400, 401, 403, 404, 409, 413, 422, 429, 500, 503])
      responses[code] = {
        description:
          code === 404
            ? 'Safe absence or generic invalid invitation proof'
            : 'Safe error',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiError' },
          },
        },
      };
    paths['/api/v1' + path] ??= {};
    paths['/api/v1' + path]![method] = {
      operationId: 'team' + method + path.replace(/[^a-zA-Z]/g, ''),
      tags: ['teams'],
      security: options.anonymous ? [] : [{ sessionCookie: [] }],
      parameters,
      responses,
      ...(input
        ? {
            requestBody: {
              required: input !== shared.CollaborationEmptySchema,
              content: {
                'application/json': {
                  schema: json(
                    input,
                    `${pointer}/requestBody/content/application~1json/schema`,
                  ),
                },
              },
            },
          }
        : {}),
    };
  };

  add('/teams', 'post', c.TeamSchema, c.TeamCreateSchema, {
    idempotency: true,
  });
  add('/teams', 'get', c.TeamPageSchema, undefined, { page: true });
  add('/teams/{id}', 'get', c.TeamSchema);
  add('/teams/{id}/access/me', 'get', ScopeAccessMeSchema, undefined, {
    etag: false,
  });
  add('/teams/{id}', 'patch', c.TeamSchema, c.TeamPatchSchema, {
    revision: true,
  });
  add('/teams/{id}/memberships', 'get', c.TeamMembershipPageSchema, undefined, {
    page: true,
  });
  add(
    '/teams/{id}/memberships/{accessId}',
    'patch',
    c.TeamMembershipSchema,
    c.TeamMembershipChangeSchema,
    { revision: true },
  );
  add(
    '/teams/{id}/invitations',
    'post',
    c.TeamInvitationDeliverySchema,
    c.TeamInvitationCreateSchema,
    { idempotency: true },
  );
  add('/teams/{id}/invitations/{offerId}', 'get', c.TeamInvitationSchema);
  add('/teams/{id}/invitations', 'get', c.TeamInvitationPageSchema, undefined, {
    page: true,
    etag: false,
  });
  add('/team-invitations', 'get', PendingInvitationPageSchema, undefined, {
    page: true,
    etag: false,
  });
  add(
    '/teams/{id}/invitations/{offerId}/revoke',
    'post',
    c.TeamInvitationSchema,
    shared.CollaborationEmptySchema,
    { revision: true },
  );
  add(
    '/teams/{id}/leave',
    'post',
    shared.SharedDepartureSchema,
    shared.CollaborationEmptySchema,
    { revision: true },
  );
  add('/teams/{id}/projects', 'get', c.TeamProjectPageSchema, undefined, {
    page: true,
  });
  add(
    '/teams/{id}/projects/{projectId}',
    'put',
    c.TeamProjectLinkSchema,
    shared.CollaborationEmptySchema,
    { etag: true },
  );
  // If-Match is required for an existing reference, optional on initial idempotent PUT.
  paths['/api/v1/teams/{id}/projects/{projectId}']!.put = {
    ...(paths['/api/v1/teams/{id}/projects/{projectId}']!.put as object),
    parameters: [
      ...(
        paths['/api/v1/teams/{id}/projects/{projectId}']!.put as {
          parameters: unknown[];
        }
      ).parameters,
      {
        in: 'header',
        name: 'If-Match',
        required: false,
        schema: { type: 'string', pattern: '^"[1-9][0-9]*"$' },
      },
    ],
  };
  add(
    '/teams/{id}/projects/{projectId}',
    'delete',
    c.TeamProjectLinkSchema,
    shared.CollaborationEmptySchema,
    { revision: true },
  );
  add(
    '/team-invitations/preview',
    'get',
    c.TeamInvitationPreviewSchema,
    undefined,
    { proof: true, anonymous: true, etag: false },
  );
  add(
    '/team-invitations/{id}/accept',
    'post',
    c.TeamInvitationAcceptanceSchema,
    shared.CollaborationEmptySchema,
    { revision: true, proof: true },
  );
  add(
    '/team-invitations/{id}/decline',
    'post',
    c.TeamInvitationSchema,
    shared.CollaborationEmptySchema,
    { revision: true, proof: true },
  );
  return paths;
}
