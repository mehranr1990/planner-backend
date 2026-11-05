import { z } from 'zod';
import * as c from './project-collaboration.js';
import * as t from './project-transfer.js';
import * as l from './project-lifecycle.js';
import {
  ProjectEmptySchema,
  ProjectPageQuerySchema,
  GrantOfferDeliverySchema,
} from './projects.js';
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
  binaryInput?: boolean;
  binaryResponse?: boolean;
  csv?: boolean;
  recovery?: boolean;
};
export const projectCollaborationOperations: Operation[] = [
  {
    path: '/projects/{projectId}/exports',
    method: 'post',
    output: c.ProjectExportSchema,
    input: c.ProjectExportInputSchema,
    csv: true,
  },
  {
    path: '/projects/{projectId}/files/reconcile',
    method: 'post',
    output: c.ProjectFileReconcileSchema,
    input: ProjectEmptySchema,
  },
  {
    path: '/projects/{projectId}/content/{targetKind}/{targetId}/comments/{commentId}/history',
    method: 'get',
    output: c.ProjectCommentVersionPageSchema,
    query: ProjectPageQuerySchema,
  },
  {
    path: '/projects/{projectId}/transfers',
    method: 'post',
    output: t.ProjectTransferSchema,
    input: t.ProjectTransferPreviewInputSchema,
    idempotency: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/transfers/{transferId}',
    method: 'get',
    output: t.ProjectTransferSchema,
    query: ProjectEmptySchema,
    etag: true,
  },
  {
    path: '/projects/{projectId}/transfers/{transferId}/accept',
    method: 'post',
    output: t.ProjectTransferSchema,
    input: t.ProjectTransferAcceptSchema,
    revision: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/transfers/{transferId}/apply',
    method: 'post',
    output: t.ProjectTransferSchema,
    input: t.ProjectTransferApplySchema,
    revision: true,
    idempotency: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/transfers/{transferId}/cancel',
    method: 'post',
    output: t.ProjectTransferSchema,
    input: ProjectEmptySchema,
    revision: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/lifecycle-job',
    method: 'get',
    output: l.ProjectLifecycleJobSchema,
    query: ProjectEmptySchema,
    etag: true,
  },
  {
    path: '/projects/{projectId}/lifecycle-job/recovery-proof',
    method: 'post',
    output: l.ProjectLifecycleProofSchema,
    input: l.ProjectLifecyclePasswordSchema,
    revision: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/lifecycle-job/recover',
    method: 'post',
    output: l.ProjectLifecycleRecoverySchema,
    input: l.ProjectLifecycleRecoverSchema,
    revision: true,
    etag: true,
    recovery: true,
  },
  {
    path: '/projects/{projectId}/documents',
    method: 'get',
    output: c.ProjectDocumentPageSchema,
    query: ProjectPageQuerySchema,
  },
  {
    path: '/projects/{projectId}/documents',
    method: 'post',
    output: c.ProjectDocumentSchema,
    input: c.ProjectDocumentCreateSchema,
    idempotency: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/documents/{documentId}',
    method: 'get',
    output: c.ProjectDocumentSchema,
    query: ProjectEmptySchema,
    etag: true,
  },
  {
    path: '/projects/{projectId}/documents/{documentId}',
    method: 'put',
    output: c.ProjectDocumentSchema,
    input: c.ProjectDocumentInputSchema,
    revision: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/documents/{documentId}',
    method: 'delete',
    output: c.ProjectDocumentSchema,
    input: ProjectEmptySchema,
    revision: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/documents/{documentId}/versions',
    method: 'get',
    output: c.ProjectDocumentVersionPageSchema,
    query: ProjectPageQuerySchema,
  },
  {
    path: '/projects/{projectId}/comments',
    method: 'post',
    output: c.ProjectCommentSchema,
    input: c.ProjectCommentCreateSchema,
    idempotency: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/content/{targetKind}/{targetId}/comments',
    method: 'get',
    output: c.ProjectCommentPageSchema,
    query: ProjectPageQuerySchema,
  },
  {
    path: '/projects/{projectId}/content/{targetKind}/{targetId}/comments/{commentId}',
    method: 'put',
    output: c.ProjectCommentSchema,
    input: c.ProjectCommentInputSchema,
    revision: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/content/{targetKind}/{targetId}/comments/{commentId}',
    method: 'delete',
    output: c.ProjectCommentSchema,
    input: ProjectEmptySchema,
    revision: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/content/{targetKind}/{targetId}/activity',
    method: 'get',
    output: c.ProjectActivityPageSchema,
    query: ProjectPageQuerySchema,
  },
  {
    path: '/projects/{projectId}/files',
    method: 'post',
    output: c.ProjectFileSchema,
    input: c.ProjectFileCreateSchema,
    idempotency: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/content/{targetKind}/{targetId}/files',
    method: 'get',
    output: c.ProjectFilePageSchema,
    query: ProjectPageQuerySchema,
  },
  {
    path: '/projects/{projectId}/content/{targetKind}/{targetId}/files/{fileId}',
    method: 'get',
    output: c.ProjectFileSchema,
    query: ProjectEmptySchema,
    etag: true,
  },
  {
    path: '/projects/{projectId}/content/{targetKind}/{targetId}/files/{fileId}',
    method: 'delete',
    output: c.ProjectFileSchema,
    input: ProjectEmptySchema,
    revision: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/content/{targetKind}/{targetId}/files/{fileId}/complete',
    method: 'post',
    output: c.ProjectFileSchema,
    binaryInput: true,
    etag: true,
  },
  {
    path: '/projects/{projectId}/content/{targetKind}/{targetId}/files/{fileId}/download',
    method: 'get',
    output: c.ProjectFileSchema,
    query: ProjectEmptySchema,
    binaryResponse: true,
  },
  {
    path: '/projects/{projectId}/views',
    method: 'get',
    output: c.ProjectViewSchema,
    query: c.ProjectViewQuerySchema,
  },
  {
    path: '/projects/{projectId}/content-grant-offers',
    method: 'post',
    output: GrantOfferDeliverySchema,
    input: c.ProjectContentGrantCreateSchema,
    idempotency: true,
  },
];
export function projectCollaborationPaths() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of projectCollaborationOperations) {
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
        schema:
          m[1] === 'targetKind'
            ? { type: 'string', enum: ['PROJECT', 'TASK', 'GOAL', 'DOCUMENT'] }
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
    if (op.recovery)
      parameters.push({
        in: 'header',
        name: 'X-Deletion-Recovery',
        required: true,
        schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' },
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
        description: 'Current authorized P2-07 result',
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
    if (op.binaryResponse)
      (responses['200'] as { content: unknown }).content = {
        'application/octet-stream': {
          schema: { type: 'string', format: 'binary' },
        },
      };
    if (op.csv)
      (responses['200'] as { content: Record<string, unknown> }).content[
        'text/csv'
      ] = { schema: { type: 'string' } };
    paths[path]![op.method] = {
      operationId:
        'projectCollaboration' + op.method + op.path.replace(/[^a-zA-Z]/g, ''),
      tags: ['project-collaboration'],
      security: [{ sessionCookie: [] }],
      parameters,
      responses,
      ...(op.binaryInput
        ? {
            requestBody: {
              required: true,
              content: {
                'application/octet-stream': {
                  schema: { type: 'string', format: 'binary' },
                },
                'application/json': {
                  schema: schema(
                    ProjectEmptySchema,
                    pointer + '/requestBody/content/application~1json/schema',
                  ),
                },
              },
            },
          }
        : {}),
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
