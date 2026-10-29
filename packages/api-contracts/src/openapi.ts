import { financePaths } from './finance-openapi.js';
import { insightPaths } from './insights-openapi.js';
import { notificationPaths } from './notifications-openapi.js';
import { writingPaths } from './writing-openapi.js';
import { focusPaths } from './focus-openapi.js';
import { goalPaths } from './goals-openapi.js';
import { taskPaths } from './tasks-openapi.js';
import { taskToolPaths } from './task-tools-openapi.js';
import { planningPaths } from './planning-openapi.js';
import { calendarPaths } from './calendar-openapi.js';
import { habitPaths } from './habits-openapi.js';
import { z } from 'zod';
import { filePaths } from './files-openapi.js';
import {
  ApiErrorSchema,
  LiveHealthSchema,
  ReadyHealthSchema,
  healthRoutes,
  authRoutes,
  authResponseSchemas,
  PasswordResetCallbackQuerySchema,
  ProfileSchema,
  ProfilePatchSchema,
  SettingsSchema,
  SettingsPatchSchema,
  PersonalSpacesSchema,
  IfMatchSchema,
  CursorQuerySchema,
} from './index.js';

// Zod is authoritative for runtime and OpenAPI boundary schemas.
export function createOpenApiDocument() {
  const json = (schema: z.ZodType) =>
    z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' });
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
  const extraPaths: Record<string, Record<string, unknown>> = {};
  const protectedOperation = (
    id: string,
    schema: z.ZodType,
    input?: z.ZodType,
  ) => ({
    operationId: id,
    security: [{ sessionCookie: [] }],
    tags: ['account'],
    ...(input
      ? {
          parameters: [
            {
              in: 'header',
              name: 'Origin',
              required: true,
              schema: { type: 'string', format: 'uri' },
            },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: json(input) } },
          },
        }
      : {}),
    responses: {
      '200': {
        description: 'Success',
        content: { 'application/json': { schema: json(schema) } },
      },
      '400': response('ApiError', 'Invalid request'),
      '401': response('ApiError', 'Authentication required'),
      '403': response('ApiError', 'Verification or trusted origin required'),
    },
  });
  extraPaths['/api/v1/me'] = {
    get: protectedOperation('getMe', ProfileSchema),
    patch: protectedOperation('updateMe', ProfileSchema, ProfilePatchSchema),
  };
  extraPaths['/api/v1/me/settings'] = {
    get: protectedOperation('getMySettings', SettingsSchema),
    patch: protectedOperation(
      'updateMySettings',
      SettingsSchema,
      SettingsPatchSchema,
    ),
  };
  const settings = extraPaths['/api/v1/me/settings'] as Record<
    string,
    Record<string, unknown>
  >;
  for (const method of ['get', 'patch']) {
    const op = settings[method]!;
    const responses = op.responses as Record<string, Record<string, unknown>>;
    responses['200']!.headers = {
      ETag: {
        description: 'Quoted positive settings revision',
        schema: IfMatchSchema.toJSONSchema(),
      },
    };
  }
  (settings.patch!.parameters as unknown[]).push({
    in: 'header',
    name: 'If-Match',
    required: false,
    description:
      'Optional for compatibility; supply the last ETag to reject stale writes with 409.',
    schema: json(IfMatchSchema),
  });
  (settings.patch!.responses as Record<string, unknown>)['409'] = response(
    'ApiError',
    'Stale or concurrent settings revision',
  );
  extraPaths['/api/v1/me/spaces'] = {
    get: protectedOperation('listMyPersonalSpaces', PersonalSpacesSchema),
  };
  for (const [key, input] of Object.entries(authRoutes)) {
    const [method, path] = key.split(' ') as [string, string];
    const name = '/api/v1/auth' + path;
    extraPaths[name] ??= {};
    const authRequired = [
      '/sign-out',
      '/list-sessions',
      '/revoke-session',
      '/revoke-sessions',
      '/revoke-other-sessions',
      '/change-email',
      '/change-password',
    ].includes(path);
    extraPaths[name][method.toLowerCase()] = {
      operationId: `auth${path.replace(/[^a-z]/gi, '_')}`,
      tags: ['auth'],
      security: authRequired ? [{ sessionCookie: [] }] : [],
      ...(method === 'POST'
        ? {
            parameters: [
              {
                in: 'header',
                name: 'Origin',
                required: true,
                schema: { type: 'string', format: 'uri' },
              },
            ],
            requestBody: {
              required: true,
              content: { 'application/json': { schema: json(input) } },
            },
          }
        : {
            parameters: Object.entries(input.shape).map(([name, field]) => ({
              in: 'query',
              name,
              required: !field.isOptional(),
              schema: json(field),
            })),
          }),
      responses: {
        '200': {
          description: 'Success',
          content: {
            'application/json': { schema: json(authResponseSchemas[key]!) },
          },
        },
        '302': { description: 'Trusted callback redirect' },
        '400': response('ApiError', 'Invalid input or token'),
        '401': response('ApiError', 'Invalid credentials or session'),
        '403': response(
          'ApiError',
          'Verification, fresh session or trusted origin required',
        ),
        '429': response('ApiError', 'Rate limited'),
      },
    };
  }
  extraPaths['/api/v1/auth/reset-password/{token}'] = {
    get: {
      operationId: 'authPasswordResetCallback',
      tags: ['auth'],
      security: [],
      parameters: [
        {
          in: 'path',
          name: 'token',
          required: true,
          schema: { type: 'string' },
        },
        {
          in: 'query',
          name: 'callbackURL',
          required: true,
          schema: json(PasswordResetCallbackQuerySchema.shape.callbackURL),
        },
      ],
      responses: {
        '302': {
          description:
            'Trusted recovery UI redirect containing the provider token',
        },
        '400': response('ApiError', 'Invalid request'),
      },
    },
  };
  return {
    openapi: '3.1.0',
    info: { title: 'Mehran Planner API', version: '0.0.1' },
    paths: {
      ...filePaths(),
      ...taskPaths(),
      ...taskToolPaths(),
      ...planningPaths(),
      ...calendarPaths(),
      ...habitPaths(),
      ...goalPaths(),
      ...focusPaths(),
      ...writingPaths(),
      ...financePaths(),
      ...notificationPaths(),
      ...insightPaths(),
      ...extraPaths,
      [healthRoutes.live]: { get: operation('healthLive', 'LiveHealth') },
      [healthRoutes.ready]: { get: operation('healthReady', 'ReadyHealth') },
    },
    components: {
      securitySchemes: {
        sessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'better-auth.session_token',
          description:
            'HttpOnly cookie; production uses the __Secure- prefix. Better Auth owns signing, expiration and validation.',
        },
      },
      schemas: {
        ApiError: json(ApiErrorSchema),
        LiveHealth: json(LiveHealthSchema),
        ReadyHealth: json(ReadyHealthSchema),
        CursorQuery: json(CursorQuerySchema),
      },
    },
  };
}
