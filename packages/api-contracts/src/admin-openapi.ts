import { adminAnalyticsRoutes } from './admin-analytics.js';
import { adminCommerceRoutes } from './admin-commerce.js';
import { adminEngagementRoutes } from './admin-engagement.js';
import { z } from 'zod';
import { embeddedJsonSchema, pointerSegment } from './embedded-json-schema.js';
import { adminAuthRoutes } from './admin.js';
import { adminSecurityRoutes } from './admin-security.js';
import { adminAuditRoutes } from './admin-audit.js';
import { adminUserSecurityRoutes } from './admin-user-security.js';
import { adminRetentionRoutes } from './admin-retention.js';
import { adminPrivacyRoutes } from './admin-privacy.js';
import { adminOperationsRoutes } from './admin-operations.js';
import {
  adminManagementRoutes,
  adminManagementResponses,
} from './admin-management.js';
export const adminPaths: Record<string, Record<string, unknown>> = {};
for (const [route, spec] of Object.entries({
  ...adminSecurityRoutes,
  ...adminAuditRoutes,
  ...adminUserSecurityRoutes,
  ...adminRetentionRoutes,
  ...adminPrivacyRoutes,
  ...adminOperationsRoutes,
  ...adminEngagementRoutes,
  ...adminCommerceRoutes,
  ...adminConfigurationRoutes,
  ...adminAnalyticsRoutes,
})) {
  const [method, suffix] = route.split(' ') as [string, string];
  const path = '/api/v1/admin/' + suffix.replace(':id', '{id}');
  const p6 =
    suffix.startsWith('configuration/') || suffix.startsWith('analytics/');
  const pointer =
    '#/paths/' + pointerSegment(path) + '/' + method.toLowerCase();
  const csv = route === 'GET audit/export';
  const file =
    route === 'GET operations/storage/files/:id/content' ||
    route.endsWith('/evidence');
  adminPaths[path] = {
    ...adminPaths[path],
    [method.toLowerCase()]: {
      operationId:
        (suffix.startsWith('analytics/')
          ? 'platformAdminP7_'
          : p6
            ? 'platformAdminP6_'
            : /^(communications|support|moderation|engagement)\//.test(suffix)
              ? 'platformAdminP4_'
              : suffix.startsWith('operations/')
                ? 'platformAdminP3_'
                : 'platformAdminP2_') +
        method.toLowerCase() +
        '_' +
        suffix.replace(/[^a-zA-Z]/g, '_'),
      tags: ['platform-admin'],
      security: [{ adminCookie: [] }],
      description: `Requires ${spec.permission}. Mutations require recent MFA and an Idempotency-Key. Critical changes require a distinct authorized approver. User login restrictions reuse P1 account suspension.${file ? ' Exact private-file access is restricted to Super Admin with the explicit private-file capability and recent MFA. Every attempt and streaming outcome is audited; scope, custody, replay, scan and hash checks apply. Inline only for PNG/JPEG; other types download.' : ''}`,
      parameters: [
        ...(suffix.includes(':id')
          ? [
              {
                in: 'path',
                name: 'id',
                required: true,
                schema: { type: 'string', format: 'uuid' },
              },
            ]
          : []),
        ...(method === 'GET'
          ? Object.entries(z.toJSONSchema(spec.schema).properties ?? {}).map(
              ([name, schema]) => ({
                in: 'query',
                name,
                schema,
                required:
                  z.toJSONSchema(spec.schema).required?.includes(name) ?? false,
              }),
            )
          : [
              {
                in: 'header',
                name: 'Idempotency-Key',
                required: true,
                schema: { type: 'string', minLength: 1, maxLength: 128 },
              },
            ]),
      ],
      ...(method !== 'GET'
        ? {
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: p6
                    ? embeddedJsonSchema(
                        z.toJSONSchema(spec.schema),
                        pointer +
                          '/requestBody/content/application~1json/schema',
                      )
                    : z.toJSONSchema(spec.schema),
                },
              },
            },
          }
        : {}),
      responses: Object.fromEntries(
        [
          200,
          400,
          401,
          403,
          404,
          409,
          429,
          500,
          ...(suffix.startsWith('operations/') || p6 ? [503] : []),
        ].map((code) => [
          String(code),
          {
            description:
              code === 200
                ? suffix.startsWith('operations/')
                  ? 'Authorized P3 operational result'
                  : 'Authorized P2 result'
                : 'Safe API error',
            content: {
              [code === 200 && file
                ? 'application/octet-stream'
                : code === 200 && csv
                  ? 'text/csv'
                  : 'application/json']: {
                schema:
                  code === 200 && file
                    ? { type: 'string', format: 'binary' }
                    : code === 200
                      ? p6
                        ? embeddedJsonSchema(
                            z.toJSONSchema(spec.response),
                            pointer +
                              '/responses/200/content/application~1json/schema',
                          )
                        : z.toJSONSchema(spec.response)
                      : { $ref: '#/components/schemas/ApiError' },
              },
            },
          },
        ]),
      ),
    },
  };
}
for (const [key, schema] of Object.entries(adminAuthRoutes)) {
  const [method, route] = key.split(' ') as [string, string];
  const path = '/api/v1/admin/auth' + route;
  adminPaths[path] = {
    [method.toLowerCase()]: {
      operationId: 'platformAdmin' + route.replace(/[^a-zA-Z]/g, '_'),
      tags: ['platform-admin'],
      description:
        'Isolated admin realm. Password-only sessions permit MFA enrollment only. TOTP enrollment revokes all sessions; sign in again. Trusted devices and disabling MFA are unavailable.',
      security:
        method === 'POST' &&
        [
          '/sign-in/email',
          '/two-factor/verify-totp',
          '/two-factor/verify-backup-code',
        ].includes(route)
          ? []
          : [{ adminCookie: [] }],
      ...(method === 'POST'
        ? {
            requestBody: {
              required: true,
              content: {
                'application/json': { schema: z.toJSONSchema(schema) },
              },
            },
          }
        : {}),
      responses: Object.fromEntries(
        [200, 400, 401, 403, 429, 500].map((code) => [
          String(code),
          {
            description:
              code === 200
                ? 'Better Auth response; session cookies are HttpOnly. Enrollment returns TOTP URI and backup codes once.'
                : 'Safe API error',
            content: {
              'application/json': {
                schema:
                  code === 200
                    ? { type: 'object' }
                    : { $ref: '#/components/schemas/ApiError' },
              },
            },
          },
        ]),
      ),
    },
  };
}
adminPaths['/api/v1/admin/session'] = {
  get: {
    operationId: 'platformAdminSession',
    tags: ['platform-admin'],
    security: [{ adminCookie: [] }],
    responses: {
      '200': {
        description: 'MFA-authenticated admin metadata only',
        content: {
          'application/json': {
            schema: z.toJSONSchema(
              z.strictObject({
                id: z.uuid(),
                role: z.enum([
                  'SUPER_ADMIN',
                  'SUPPORT',
                  'BILLING_MANAGER',
                  'SECURITY_REVIEWER',
                ]),
                expiresAt: z.iso.datetime(),
              }),
            ),
          },
        },
      },
      '401': { description: 'No valid admin session' },
      '403': { description: 'MFA or permission required' },
    },
  },
};
for (const [route, spec] of Object.entries(adminManagementRoutes)) {
  const [method, suffix] = route.split(' ') as [string, string];
  const path = '/api/v1/admin/' + suffix.replace(':id', '{id}');
  const operation = {
    operationId:
      'platformAdminManagement_' +
      method.toLowerCase() +
      '_' +
      suffix.replace(/[^a-zA-Z]/g, '_'),
    tags: ['platform-admin'],
    security: [{ adminCookie: [] }],
    description: `Requires ${spec.permission}. Metadata only. Mutations require successful MFA in the past five minutes. UTC date intervals include from and exclude until.`,
    parameters: [
      ...(method !== 'GET' && !suffix.startsWith('users')
        ? [
            {
              in: 'header',
              name: 'Idempotency-Key',
              required: false,
              schema: { type: 'string', minLength: 1, maxLength: 128 },
              description:
                'Required for shared Workspace mutations; binds exact validated input and Admin actor.',
            },
          ]
        : []),
      ...(suffix.includes(':id')
        ? [
            {
              in: 'path',
              name: 'id',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ]
        : []),
      ...(method === 'GET'
        ? Object.entries(z.toJSONSchema(spec.schema).properties ?? {}).map(
            ([name, schema]) => ({ in: 'query', name, schema }),
          )
        : []),
    ],
    ...(method !== 'GET'
      ? {
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: z.toJSONSchema(spec.schema) },
            },
          },
        }
      : {}),
    responses: Object.fromEntries(
      [200, 400, 401, 403, 404, 409, 429, 500].map((code) => [
        String(code),
        {
          description:
            code === 200
              ? 'Authorized administrative metadata; unavailable metrics carry an explicit availability reason'
              : 'Safe API error',
          content: {
            [suffix.endsWith('/export') && code === 200
              ? 'text/csv'
              : 'application/json']: {
              schema:
                code === 200
                  ? suffix.endsWith('/export')
                    ? { type: 'string' }
                    : z.toJSONSchema(
                        adminManagementResponses[
                          route as keyof typeof adminManagementResponses
                        ],
                      )
                  : { $ref: '#/components/schemas/ApiError' },
            },
          },
        },
      ]),
    ),
  };
  adminPaths[path] = { ...adminPaths[path], [method.toLowerCase()]: operation };
}

export const adminEngagementPaths: Record<string, Record<string, unknown>> = {};
for (const route of Object.keys(adminEngagementRoutes)) {
  const suffix = route.split(' ')[1]!,
    path = '/api/v1/admin/' + suffix.replace(':id', '{id}');
  adminEngagementPaths[path] = adminPaths[path]!;
}
for (const path of Object.keys(adminEngagementPaths)) delete adminPaths[path];

for (const [path, methods] of Object.entries(adminEngagementPaths)) {
  if (path.includes('/engagement/policies/{id}'))
    for (const operation of Object.values(methods)) {
      const item = operation as {
        parameters?: { name: string; schema: unknown }[];
      };
      const parameter = item.parameters?.find((p) => p.name === 'id');
      if (parameter)
        parameter.schema = {
          type: 'string',
          enum: ['SUPPORT', 'MODERATION', 'COMMUNICATIONS'],
        };
    }
}
import { adminConfigurationRoutes } from './admin-configuration.js';
