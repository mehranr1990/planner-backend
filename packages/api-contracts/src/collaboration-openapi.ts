import { z } from 'zod';
import * as c from './collaboration.js';
import { embeddedJsonSchema, pointerSegment } from './embedded-json-schema.js';
export function collaborationPaths(): Record<string, Record<string, unknown>> {
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
        schema: { type: 'string', format: 'uuid' },
      });
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
          'Authorized P2-02 result; shared activation prerequisites remain mandatory',
        headers: {
          'Cache-Control': { schema: { type: 'string', const: 'no-store' } },
          ...(!options.anonymous
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
      operationId: 'shared' + method + path.replace(/[^a-zA-Z]/g, ''),
      tags: ['shared-collaboration'],
      security: options.anonymous ? [] : [{ sessionCookie: [] }],
      parameters,
      responses,
      ...(input
        ? {
            requestBody: {
              required: input !== c.CollaborationEmptySchema,
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
  add(
    '/spaces/{spaceId}/invitations',
    'post',
    c.InvitationDeliverySchema,
    c.InvitationCreateSchema,
    { idempotency: true },
  );
  add('/spaces/{spaceId}/invitations/{id}', 'get', c.InvitationSchema);
  add('/invitations/preview', 'get', c.InvitationPreviewSchema, undefined, {
    proof: true,
    anonymous: true,
  });
  add(
    '/invitations/{id}/accept',
    'post',
    c.InvitationAcceptanceSchema,
    c.CollaborationEmptySchema,
    { proof: true, revision: true },
  );
  add(
    '/invitations/{id}/decline',
    'post',
    c.InvitationSchema,
    c.CollaborationEmptySchema,
    { proof: true, revision: true },
  );
  add(
    '/spaces/{spaceId}/invitations/{id}/revoke',
    'post',
    c.InvitationSchema,
    c.CollaborationEmptySchema,
    { revision: true },
  );
  add(
    '/spaces/{spaceId}/memberships/{id}',
    'patch',
    c.SharedMembershipSchema,
    c.MembershipChangeSchema,
    { revision: true },
  );
  add(
    '/spaces/{spaceId}/leave',
    'post',
    c.SharedDepartureSchema,
    c.CollaborationEmptySchema,
    { revision: true },
  );
  add(
    '/spaces/{spaceId}/ownership-handovers',
    'post',
    c.OwnerHandoverSchema,
    c.HandoverCreateSchema,
    { idempotency: true },
  );
  add(
    '/spaces/{spaceId}/ownership-handovers/{id}',
    'get',
    c.OwnerHandoverSchema,
  );
  add(
    '/spaces/{spaceId}/ownership-handovers/{id}/accept',
    'post',
    c.OwnerHandoverSchema,
    c.HandoverAcceptSchema,
    { revision: true },
  );
  add(
    '/spaces/{spaceId}/ownership-handovers/{id}/decline',
    'post',
    c.OwnerHandoverSchema,
    c.CollaborationEmptySchema,
    { revision: true },
  );
  add(
    '/spaces/{spaceId}/ownership-handovers/{id}/revoke',
    'post',
    c.OwnerHandoverSchema,
    c.CollaborationEmptySchema,
    { revision: true },
  );
  return paths;
}
