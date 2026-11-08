import { z } from 'zod';
import * as c from './messaging.js';
import { embeddedJsonSchema, pointerSegment } from './embedded-json-schema.js';
import { advancedMessagingOperations } from './advanced-messaging-openapi.js';
type Operation = {
  path: string;
  method: 'get' | 'post' | 'patch';
  output: z.ZodType;
  input?: z.ZodType;
  query?: z.ZodType;
  revision?: boolean;
  key?: boolean;
  etag?: boolean;
  conditionalRevision?: boolean;
};
export const messagingOperations: Operation[] = [
  {
    path: '/conversations',
    method: 'post',
    input: c.ConversationCreateSchema,
    output: c.ConversationSchema,
    key: true,
    etag: true,
  },
  {
    path: '/conversations',
    method: 'get',
    query: c.ConversationPageQuerySchema,
    output: c.ConversationPageSchema,
  },
  {
    path: '/conversations/{id}',
    method: 'get',
    output: c.ConversationSchema,
    etag: true,
  },
  {
    path: '/conversations/{id}/members',
    method: 'get',
    query: c.ConversationPageQuerySchema,
    output: c.ConversationMemberPageSchema,
  },
  {
    path: '/conversations/{id}/invitations',
    method: 'post',
    input: c.ConversationInvitationInputSchema,
    output: c.ConversationInvitationSchema,
    revision: true,
    key: true,
    etag: true,
  },
  {
    path: '/conversations/{id}/invitations/{invitationId}/revoke',
    method: 'post',
    input: c.ConversationEmptySchema,
    output: c.ConversationInvitationSchema,
    revision: true,
    etag: true,
  },
  {
    path: '/conversation-invitations',
    method: 'get',
    query: c.ConversationPageQuerySchema,
    output: c.ConversationInvitationPageSchema,
  },
  ...(['accept', 'decline'] as const).map((action) => ({
    path: '/conversation-invitations/{invitationId}/' + action,
    method: 'post' as const,
    input: c.ConversationEmptySchema,
    output: c.ConversationInvitationSchema,
    revision: true,
    etag: true,
  })),
  {
    path: '/conversations/{id}/members/{memberId}',
    method: 'patch',
    input: c.ConversationRoleInputSchema,
    output: c.ConversationMemberSchema,
    revision: true,
    etag: true,
  },
  {
    path: '/conversations/{id}/members/{memberId}/remove',
    method: 'post',
    input: c.ConversationEmptySchema,
    output: c.ConversationMemberSchema,
    revision: true,
    etag: true,
  },
  {
    path: '/conversations/{id}/leave',
    method: 'post',
    input: c.ConversationEmptySchema,
    output: c.ConversationMemberSchema,
    revision: true,
    etag: true,
  },
  {
    path: '/conversations/{id}/messages',
    method: 'post',
    input: c.ConversationMessageInputSchema,
    output: c.ConversationMessageSchema,
    key: true,
  },
  {
    path: '/conversations/{id}/messages',
    method: 'get',
    query: c.ConversationPageQuerySchema,
    output: c.ConversationMessagePageSchema,
  },
];
export function messagingPaths() {
  return messagingOperationPaths(messagingOperations);
}
export function advancedMessagingPaths() {
  return messagingOperationPaths(advancedMessagingOperations as Operation[]);
}
function messagingOperationPaths(operations: Operation[]) {
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
    if (op.key)
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
    if (op.conditionalRevision)
      parameters.push({
        in: 'header',
        name: 'If-Match',
        required: false,
        description:
          'Required for edit, delete, pin, moderate, resolve-report and policy. Use the current message/report/policy revision.',
        schema: { type: 'string', pattern: '^"[1-9][0-9]*"$' },
      });
    if (op.query) {
      const query = z.toJSONSchema(op.query, { io: 'input' }) as {
        properties: Record<string, unknown>;
        required?: string[];
      };
      for (const [name, value] of Object.entries(query.properties))
        parameters.push({
          in: 'query',
          name,
          required: query.required?.includes(name) ?? false,
          schema: value,
        });
    }
    const status = op.method === 'post' ? 201 : 200;
    const responses: Record<string, unknown> = {
      [status]: {
        description: 'Current authorized messaging result',
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
      operationId: 'messaging' + op.method + op.path.replace(/[^a-zA-Z]/g, ''),
      tags: ['messaging'],
      security: [{ sessionCookie: [] }],
      parameters,
      responses,
      ...(op.input
        ? {
            requestBody: {
              required: op.input !== c.ConversationEmptySchema,
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
