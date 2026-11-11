import { z } from 'zod';
import * as c from './social.js';
import * as shared from './collaboration.js';
import {
  DmContactBlockSchema,
  DmContactPageSchema,
} from './communication-lifecycle.js';
import { embeddedJsonSchema, pointerSegment } from './embedded-json-schema.js';
export function socialPaths(): Record<string, Record<string, unknown>> {
  const paths: Record<string, Record<string, unknown>> = {};
  type Options = {
    page?: boolean;
    key?: boolean;
    revision?: boolean;
    proof?: boolean;
    anonymous?: boolean;
    etag?: boolean;
  };
  function add(
    path: string,
    method: string,
    output: z.ZodType,
    input?: z.ZodType,
    options: Options = {},
  ) {
    const route = '/api/v1' + path,
      pointer = `#/paths/${pointerSegment(route)}/${method}`,
      success = method === 'post' ? 201 : 200;
    const json = (v: z.ZodType, at: string) =>
      embeddedJsonSchema(
        z.toJSONSchema(v, { target: 'draft-2020-12', io: 'input' }),
        at,
      );
    const parameters: unknown[] = [];
    for (const match of path.matchAll(/\{(\w+)\}/g))
      parameters.push({
        in: 'path',
        name: match[1],
        required: true,
        schema:
          match[1] === 'action'
            ? {
                type: 'string',
                enum: path.includes('join-requests')
                  ? ['approve', 'reject', 'cancel']
                  : ['accept', 'decline', 'cancel', 'remove'],
              }
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
    if (options.revision)
      parameters.push({
        in: 'header',
        name: 'If-Match',
        required: true,
        schema: { type: 'string', pattern: '^"[1-9][0-9]*"$' },
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
    const responses: Record<string, unknown> = {
      [success]: {
        description:
          'Authorized P6-01 result; discovery grants no private access',
        headers: {
          'Cache-Control': { schema: { type: 'string', const: 'no-store' } },
          ...(options.etag ? { ETag: { schema: { type: 'string' } } } : {}),
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
    for (const status of [400, 401, 403, 404, 409, 413, 422, 429, 500, 503])
      responses[status] = {
        description:
          status === 404
            ? 'Safe absence or unavailable contact/invitation'
            : 'Safe error',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiError' },
          },
        },
      };
    paths[route] ??= {};
    paths[route]![method] = {
      operationId: 'social' + method + path.replace(/[^a-zA-Z]/g, ''),
      tags: ['social'],
      security: options.anonymous ? [] : [{ sessionCookie: [] }],
      parameters,
      responses,
      ...(input
        ? {
            requestBody: {
              required: input !== c.SocialEmptySchema,
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
  }
  const empty = c.SocialEmptySchema;
  add('/social/privacy', 'get', c.SocialPrivacySchema, undefined, {
    etag: true,
  });
  add(
    '/social/privacy',
    'patch',
    c.SocialPrivacySchema,
    c.SocialPrivacyPatchSchema,
    { key: true, revision: true, etag: true },
  );
  add(
    '/social/discovery',
    'post',
    c.SocialDiscoveryResultSchema,
    c.SocialDiscoverySchema,
  );
  add('/social/connections', 'get', c.SocialConnectionPageSchema, undefined, {
    page: true,
  });
  add(
    '/social/connections',
    'post',
    c.SocialConnectionSchema,
    c.SocialConnectionCreateSchema,
    { key: true, etag: true },
  );
  add(
    '/social/connections/{id}/{action}',
    'post',
    c.SocialConnectionSchema,
    empty,
    { key: true, revision: true, etag: true },
  );
  add('/social/blocks', 'get', DmContactPageSchema, undefined, { page: true });
  add(
    '/social/blocks',
    'post',
    DmContactBlockSchema,
    c.SocialBlockCreateSchema,
    { key: true, revision: true, etag: true },
  );
  add('/social/blocks/{id}/unblock', 'post', DmContactBlockSchema, empty, {
    key: true,
    revision: true,
    etag: true,
  });
  add('/social/restore-replay', 'post', c.SocialReplaySchema, empty);
  add('/social/circles', 'get', c.SocialCirclePageSchema, undefined, {
    page: true,
  });
  add(
    '/social/circles',
    'post',
    c.SocialCircleSchema,
    c.SocialCircleCreateSchema,
    { key: true, etag: true },
  );
  add('/social/circles/{id}', 'get', c.SocialCircleSchema, undefined, {
    etag: true,
  });
  add(
    '/social/circles/{id}',
    'patch',
    c.SocialCircleSchema,
    c.SocialCirclePatchSchema,
    { key: true, revision: true, etag: true },
  );
  add('/social/circles/{id}', 'delete', c.SocialCircleSchema, empty, {
    key: true,
    revision: true,
    etag: true,
  });
  add(
    '/social/circles/{id}/members',
    'get',
    c.SocialCircleMemberPageSchema,
    undefined,
    { page: true },
  );
  for (const method of ['put', 'delete'])
    add(
      '/social/circles/{id}/members/{connectionId}',
      method,
      c.SocialCircleMemberSchema,
      empty,
      { key: true, revision: true },
    );
  add(
    '/social-groups',
    'post',
    c.SocialGroupSchema,
    c.SocialGroupCreateSchema,
    { key: true, etag: true },
  );
  add('/social-groups', 'get', c.SocialGroupPageSchema, undefined, {
    page: true,
  });
  add(
    '/social-groups/discover',
    'get',
    c.SocialGroupDiscoveryPageSchema,
    undefined,
    { page: true },
  );
  add('/social-groups/{id}', 'get', c.SocialGroupSchema, undefined, {
    etag: true,
  });
  add(
    '/social-groups/{id}',
    'patch',
    c.SocialGroupSchema,
    c.SocialGroupPatchSchema,
    { revision: true, etag: true },
  );
  add(
    '/social-groups/{id}/memberships',
    'get',
    c.SocialMembershipPageSchema,
    undefined,
    { page: true },
  );
  add(
    '/social-groups/{id}/memberships/{accessId}',
    'patch',
    c.SocialMembershipSchema,
    c.SocialMembershipChangeSchema,
    { revision: true, etag: true },
  );
  add(
    '/social-groups/{id}/invitations',
    'post',
    c.SocialGroupInvitationDeliverySchema,
    c.SocialGroupInvitationCreateSchema,
    { key: true },
  );
  add(
    '/social-groups/{id}/invitations/{offerId}',
    'get',
    c.SocialGroupInvitationSchema,
  );
  add(
    '/social-groups/{id}/invitations/{offerId}/revoke',
    'post',
    c.SocialGroupInvitationSchema,
    empty,
    { revision: true },
  );
  add(
    '/social-groups/{id}/join-requests',
    'post',
    c.SocialJoinRequestSchema,
    c.SocialJoinCreateSchema,
    { key: true },
  );
  add(
    '/social-groups/{id}/join-requests',
    'get',
    c.SocialJoinRequestPageSchema,
    undefined,
    { page: true },
  );
  add(
    '/social-groups/{id}/join-requests/{requestId}/{action}',
    'post',
    c.SocialJoinRequestSchema,
    empty,
    { revision: true },
  );
  add(
    '/social-groups/{id}/leave',
    'post',
    shared.SharedDepartureSchema,
    empty,
    { revision: true },
  );
  add(
    '/social-groups/{id}/handovers',
    'post',
    shared.OwnerHandoverSchema,
    shared.HandoverCreateSchema,
    { key: true },
  );
  add(
    '/social-groups/{id}/handovers/{handoverId}',
    'get',
    shared.OwnerHandoverSchema,
  );
  for (const action of ['decline', 'revoke'])
    add(
      '/social-groups/{id}/handovers/{handoverId}/' + action,
      'post',
      shared.OwnerHandoverSchema,
      empty,
      { revision: true },
    );
  add(
    '/social-groups/{id}/handovers/{handoverId}/accept',
    'post',
    shared.OwnerHandoverSchema,
    shared.HandoverAcceptSchema,
    { revision: true },
  );
  add(
    '/social-group-invitations/preview',
    'get',
    c.SocialGroupInvitationPreviewSchema,
    undefined,
    { proof: true, anonymous: true },
  );
  add(
    '/social-group-invitations/{id}/accept',
    'post',
    c.SocialGroupInvitationAcceptanceSchema,
    empty,
    { proof: true, revision: true },
  );
  add(
    '/social-group-invitations/{id}/decline',
    'post',
    c.SocialGroupInvitationSchema,
    empty,
    { proof: true, revision: true },
  );
  return paths;
}
