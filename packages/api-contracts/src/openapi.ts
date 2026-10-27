import { z } from 'zod';
import {
  ApiErrorSchema,
  LiveHealthSchema,
  ReadyHealthSchema,
  healthRoutes,
} from './index.js';

// Zod is authoritative for runtime and OpenAPI boundary schemas.
export function createOpenApiDocument() {
  const json = (schema: z.ZodType) =>
    z.toJSONSchema(schema, { target: 'draft-2020-12' });
  const response = (name: string, description: string) => ({
    description,
    headers: {
      'X-Request-Id': {
        description: 'Server request UUID',
        schema: { type: 'string', format: 'uuid' },
      },
    },
    content: {
      'application/json': { schema: { $ref: `#/components/schemas/${name}` } },
    },
  });
  const operation = (id: string, schema: string) => ({
    operationId: id,
    tags: ['health'],
    security: [],
    responses: {
      '200': response(schema, 'Healthy'),
      '400': response('ApiError', 'Invalid query or malformed request'),
      ...(id === 'healthReady'
        ? { '503': response('ApiError', 'Database unavailable') }
        : {}),
    },
  });
  return {
    openapi: '3.1.0',
    info: { title: 'Mehran Planner API', version: '0.0.1' },
    paths: {
      [healthRoutes.live]: { get: operation('healthLive', 'LiveHealth') },
      [healthRoutes.ready]: { get: operation('healthReady', 'ReadyHealth') },
    },
    components: {
      schemas: {
        ApiError: json(ApiErrorSchema),
        LiveHealth: json(LiveHealthSchema),
        ReadyHealth: json(ReadyHealthSchema),
      },
    },
  };
}
