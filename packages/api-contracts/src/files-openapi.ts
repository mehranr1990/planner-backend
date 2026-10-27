import { z } from 'zod';
import { EmptyQuerySchema } from './index.js';
import {
  FileUploadSchema,
  StoredFileSchema,
  FileIdSchema,
  FileDownloadQuerySchema,
} from './files.js';

export function filePaths() {
  const json = (schema: z.ZodType) =>
    z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' });
  const errors = Object.fromEntries(
    [400, 401, 403, 404, 409, 413, 415, 429, 503].map((status) => [
      status,
      {
        description: 'Safe standard error; inaccessible files use 404',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiError' },
          },
        },
      },
    ]),
  );
  const id = {
    in: 'path',
    name: 'id',
    required: true,
    schema: json(FileIdSchema),
  };
  const origin = {
    in: 'header',
    name: 'Origin',
    required: true,
    schema: { type: 'string', format: 'uri' },
  };
  const metadata = {
    description:
      'Owned file metadata; no volume path/object key. READY contains a short-lived authenticated download link.',
    content: { 'application/json': { schema: json(StoredFileSchema) } },
  };
  const base = { tags: ['files'], security: [{ sessionCookie: [] }] };
  return {
    '/api/v1/files/uploads': {
      post: {
        ...base,
        operationId: 'initiateFile',
        parameters: [
          origin,
          {
            in: 'header',
            name: 'Idempotency-Key',
            required: false,
            schema: { type: 'string', minLength: 1, maxLength: 128 },
          },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: json(FileUploadSchema) } },
        },
        responses: { ...errors, '201': metadata },
      },
    },
    '/api/v1/files/{id}/complete': {
      post: {
        ...base,
        operationId: 'completeFile',
        parameters: [id, origin],
        description:
          'INITIATED: stream the exact bytes as application/octet-stream. READY: POST {} as application/json to retry/renew the download link. Completion never accepts an object key, URL or caller-supplied actual metadata.',
        requestBody: {
          required: true,
          content: {
            'application/octet-stream': {
              schema: { type: 'string', format: 'binary' },
            },
            'application/json': { schema: json(EmptyQuerySchema) },
          },
        },
        responses: { ...errors, '200': metadata },
      },
    },
    '/api/v1/files/{id}/download': {
      get: {
        ...base,
        operationId: 'downloadFile',
        parameters: [
          id,
          ...Object.entries(FileDownloadQuerySchema.shape).map(
            ([name, schema]) => ({
              in: 'query',
              name,
              required: true,
              schema: json(schema),
            }),
          ),
        ],
        description:
          'Requires a current verified owner session AND a valid short-lived signature. Streamed as an attachment; no ranges or inline rendering.',
        responses: {
          ...errors,
          '200': {
            description: 'Verified file bytes',
            headers: {
              'Content-Disposition': { schema: { type: 'string' } },
              'Content-Length': { schema: { type: 'integer' } },
              'Cache-Control': {
                schema: { type: 'string', const: 'no-store' },
              },
            },
            content: {
              'application/octet-stream': {
                schema: { type: 'string', format: 'binary' },
              },
            },
          },
        },
      },
    },
    '/api/v1/files/{id}': {
      delete: {
        ...base,
        operationId: 'deleteFile',
        parameters: [id, origin],
        responses: {
          ...errors,
          '204': {
            description:
              'Logically deleted and physical cleanup confirmed; repeat deletion retries cleanup safely.',
          },
        },
      },
    },
  };
}
