import { z } from 'zod';
import { adminAuthRoutes } from './admin.js';
export const adminPaths: Record<string, Record<string, unknown>> = {};
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
