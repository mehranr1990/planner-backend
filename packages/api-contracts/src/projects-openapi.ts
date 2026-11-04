import { z } from 'zod';
import * as c from './projects.js';
import * as shared from './collaboration.js';
import { embeddedJsonSchema, pointerSegment } from './embedded-json-schema.js';
export function projectPaths(): Record<string, Record<string, unknown>> {
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
          'Authorized P2-03 result; shared activation prerequisites remain mandatory',
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
      operationId: 'project' + method + path.replace(/[^a-zA-Z]/g, ''),
      tags: ['projects'],
      security: options.anonymous ? [] : [{ sessionCookie: [] }],
      parameters,
      responses,
      ...(input
        ? {
            requestBody: {
              required: input !== c.ProjectEmptySchema,
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
  add('/projects', 'post', c.ProjectSchema, c.ProjectCreateSchema, {
    idempotency: true,
  });
  add('/projects', 'get', c.ProjectPageSchema, undefined, { page: true });
  add('/projects/{id}', 'get', c.ProjectSchema, undefined, {});
  add('/projects/{id}', 'patch', c.ProjectSchema, c.ProjectPatchSchema, {
    revision: true,
  });
  add(
    '/projects/{id}/archive',
    'post',
    c.ProjectAssociationResultSchema,
    c.ProjectEmptySchema,
    { revision: true },
  );
  add(
    '/projects/{id}/restore',
    'post',
    c.ProjectAssociationResultSchema,
    c.ProjectEmptySchema,
    { revision: true },
  );
  add(
    '/projects/{id}/deletion-request',
    'post',
    c.ProjectAssociationResultSchema,
    shared.HandoverAcceptSchema,
    { revision: true },
  );
  add('/projects/{id}/lifecycle', 'get', c.ProjectLifecycleSchema, undefined, {
    etag: false,
  });
  add(
    '/projects/{id}/access-policy',
    'get',
    c.ProjectPolicySchema,
    undefined,
    {},
  );
  add(
    '/projects/{id}/access-policy',
    'put',
    c.ProjectPolicySchema,
    c.ProjectPolicyPublishSchema,
    { revision: true },
  );
  add(
    '/projects/{id}/components/{kind}',
    'get',
    c.ProjectComponentPageSchema,
    undefined,
    { page: true },
  );
  add(
    '/projects/{id}/components/{kind}',
    'post',
    c.ProjectComponentSchema,
    c.ProjectComponentCreateSchema,
    { idempotency: true },
  );
  add(
    '/projects/{id}/components/{kind}/{componentId}',
    'patch',
    c.ProjectComponentSchema,
    c.ProjectComponentPatchSchema,
    { revision: true },
  );
  add(
    '/projects/{id}/components/{kind}/{componentId}',
    'delete',
    c.ProjectAssociationResultSchema,
    c.ProjectEmptySchema,
    { revision: true },
  );
  add('/projects/{id}/tasks', 'get', c.SharedTaskPageSchema, undefined, {
    page: true,
  });
  add(
    '/projects/{id}/tasks',
    'post',
    c.SharedTaskSchema,
    c.ProjectTaskCreateSchema,
    { idempotency: true },
  );
  add(
    '/projects/{id}/tasks/{taskId}',
    'get',
    c.SharedTaskSchema,
    undefined,
    {},
  );
  add(
    '/projects/{id}/tasks/{taskId}',
    'patch',
    c.SharedTaskSchema,
    c.ProjectTaskPatchSchema,
    { idempotency: true, revision: true },
  );
  add(
    '/projects/{id}/tasks/{taskId}/association',
    'get',
    c.ProjectTaskAssociationViewSchema,
    undefined,
    { etag: false },
  );
  add(
    '/projects/{id}/tasks/{taskId}/association',
    'put',
    c.ProjectAssociationResultSchema,
    c.ProjectTaskAssociationSchema,
    { revision: true },
  );
  add('/projects/{id}/goals', 'get', c.SharedGoalPageSchema, undefined, {
    page: true,
  });
  add(
    '/projects/{id}/goals',
    'post',
    c.SharedGoalSchema,
    c.ProjectGoalCreateSchema,
    { idempotency: true },
  );
  add(
    '/projects/{id}/goals/{goalId}',
    'get',
    c.SharedGoalSchema,
    undefined,
    {},
  );
  add(
    '/projects/{id}/goals/{goalId}',
    'patch',
    c.SharedGoalSchema,
    c.ProjectGoalPatchSchema,
    { idempotency: true, revision: true },
  );
  add(
    '/projects/{id}/goals/{goalId}/association',
    'get',
    c.ProjectGoalAssociationViewSchema,
    undefined,
    { etag: false },
  );
  add(
    '/projects/{id}/goals/{goalId}/association',
    'put',
    c.ProjectAssociationResultSchema,
    c.ProjectGoalAssociationSchema,
    { revision: true },
  );
  add(
    '/projects/{id}/goals/{goalId}/tasks/{taskId}',
    'put',
    c.ProjectAssociationResultSchema,
    c.ProjectEmptySchema,
    { revision: true },
  );
  add(
    '/projects/{id}/member-assignments',
    'get',
    c.ProjectMemberAssignmentPageSchema,
    undefined,
    { page: true },
  );
  add(
    '/projects/{id}/member-assignments',
    'post',
    c.ProjectMemberAssignmentSchema,
    c.ProjectMemberAssignmentCreateSchema,
    { idempotency: true },
  );
  add(
    '/projects/{id}/member-assignments/{assignmentId}/revoke',
    'post',
    c.ProjectMemberAssignmentSchema,
    c.ProjectEmptySchema,
    { revision: true },
  );
  add(
    '/projects/{id}/leave-collaboration',
    'post',
    shared.SharedDepartureSchema,
    c.ProjectEmptySchema,
    { revision: true },
  );
  add(
    '/projects/{id}/resource-invitations',
    'post',
    c.GrantOfferDeliverySchema,
    c.GrantOfferCreateSchema,
    { idempotency: true },
  );
  add(
    '/projects/{id}/resource-invitations/{offerId}',
    'get',
    c.GrantOfferSchema,
    undefined,
    {},
  );
  add(
    '/projects/{id}/resource-invitations/{offerId}/revoke',
    'post',
    c.GrantOfferSchema,
    c.ProjectEmptySchema,
    { revision: true },
  );
  add(
    '/projects/{id}/grants/{grantId}/revoke',
    'post',
    c.ResourceGrantSchema,
    c.ProjectEmptySchema,
    { revision: true },
  );
  add(
    '/resource-invitations/preview',
    'get',
    c.ResourceInvitationPreviewSchema,
    undefined,
    { proof: true, anonymous: true, etag: false },
  );
  add(
    '/resource-invitations/{id}/accept',
    'post',
    c.GrantOfferAcceptanceSchema,
    c.ProjectEmptySchema,
    { revision: true, proof: true },
  );
  add(
    '/resource-invitations/{id}/decline',
    'post',
    c.GrantOfferSchema,
    c.ProjectEmptySchema,
    { revision: true, proof: true },
  );
  return paths;
}
