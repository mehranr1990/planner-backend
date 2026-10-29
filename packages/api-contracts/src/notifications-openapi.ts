import { z } from 'zod';
import * as n from './notifications.js';
import { TaskIdSchema } from './tasks.js';
import { IfMatchSchema } from './foundation.js';
const EmptyQuerySchema = z.strictObject({});
export function notificationPaths(): Record<string, Record<string, unknown>> {
  const paths: Record<string, Record<string, unknown>> = {},
    json = (s: z.ZodType) =>
      z.toJSONSchema(s, { target: 'draft-2020-12', io: 'input' });
  function add(
    path: string,
    method: string,
    output: z.ZodType,
    input?: z.ZodType,
    query?: z.ZodObject,
    create = false,
  ) {
    const parameters: unknown[] = [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({
      in: 'path',
      name: m[1],
      required: true,
      schema: json(TaskIdSchema),
    }));
    if (method !== 'get') {
      parameters.push(
        {
          in: 'header',
          name: 'Origin',
          required: true,
          schema: { type: 'string', format: 'uri' },
        },
        {
          in: 'header',
          name: 'Idempotency-Key',
          required: true,
          schema: {
            type: 'string',
            minLength: 1,
            maxLength: 128,
            pattern: '^[!-~]+$',
          },
        },
      );
      if (!create)
        parameters.push({
          in: 'header',
          name: 'If-Match',
          required: true,
          schema: json(IfMatchSchema),
        });
    }
    for (const [name, s] of Object.entries(query?.shape ?? {}))
      parameters.push({
        in: 'query',
        name,
        required: !s.isOptional(),
        schema: json(s),
      });
    const responses: Record<string, unknown> = {};
    for (const code of [400, 401, 403, 404, 409, 413, 429, 500, 503])
      responses[code] = {
        description:
          'Safe error; foreign/missing resources are 404, stale revisions 409.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiError' },
          },
        },
      };
    responses[create ? 201 : 200] = {
      description:
        'Owned result. External transports contain only generic text and opaque identifiers.',
      headers:
        !path.endsWith('/deliveries') && !query
          ? {
              ETag: {
                schema: json(IfMatchSchema),
                description: 'Quoted resource revision',
              },
            }
          : {},
      content: { 'application/json': { schema: json(output) } },
    };
    const full = '/api/v1' + path;
    paths[full] ??= {};
    paths[full][method] = {
      operationId: method + 'Notification' + path.replace(/[^a-zA-Z]/g, ''),
      tags: ['notifications'],
      security: [{ sessionCookie: [] }],
      parameters,
      ...(input
        ? {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: json(input) } },
            },
          }
        : {}),
      responses,
      ...(path === '/notifications/test'
        ? { description: 'Nonproduction only; returns 404 in production.' }
        : {}),
    };
  }
  add(
    '/reminders',
    'get',
    n.ReminderPageSchema,
    undefined,
    n.ReminderQuerySchema,
  );
  add(
    '/reminders',
    'post',
    n.ReminderSchema,
    n.ReminderCreateSchema,
    undefined,
    true,
  );
  add('/reminders/{id}', 'get', n.ReminderSchema);
  add('/reminders/{id}', 'patch', n.ReminderSchema, n.ReminderPatchSchema);
  add('/reminders/{id}', 'delete', n.ReminderSchema);
  for (const action of ['pause', 'resume'])
    add(
      '/reminders/{id}/' + action,
      'post',
      n.ReminderSchema,
      EmptyQuerySchema,
    );
  add(
    '/reminders/{id}/deliveries',
    'get',
    n.NotificationDeliveryPageSchema,
    undefined,
    n.NotificationDeliveryQuerySchema,
  );
  add(
    '/notifications',
    'get',
    n.NotificationPageSchema,
    undefined,
    n.NotificationQuerySchema,
  );
  add('/notifications/preferences', 'get', n.NotificationPreferenceSchema);
  add(
    '/notifications/preferences',
    'patch',
    n.NotificationPreferenceSchema,
    n.NotificationPreferencePatchSchema,
  );
  add(
    '/notifications/test',
    'post',
    n.ReminderSchema,
    n.NotificationTestSchema,
    undefined,
    true,
  );
  add('/notifications/{id}', 'get', n.NotificationSchema);
  add(
    '/notifications/{id}/read',
    'patch',
    n.NotificationSchema,
    n.NotificationReadSchema,
  );
  add(
    '/notifications/{id}/dismiss',
    'post',
    n.NotificationSchema,
    EmptyQuerySchema,
  );
  add(
    '/notifications/{id}/snooze',
    'post',
    n.NotificationSnoozeResultSchema,
    n.NotificationSnoozeSchema,
  );
  add(
    '/push/subscriptions',
    'get',
    n.PushSubscriptionPageSchema,
    undefined,
    n.PushSubscriptionQuerySchema,
  );
  add(
    '/push/subscriptions',
    'post',
    n.PushSubscriptionSchema,
    n.PushSubscriptionCreateSchema,
    undefined,
    true,
  );
  add(
    '/push/subscriptions/{id}',
    'patch',
    n.PushSubscriptionSchema,
    n.PushSubscriptionCreateSchema,
  );
  add('/push/subscriptions/{id}', 'delete', n.PushSubscriptionSchema);
  return paths;
}
