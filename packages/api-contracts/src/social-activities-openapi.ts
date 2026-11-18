import { z } from 'zod';
import * as c from './social-activities.js';
import { SocialEmptySchema } from './social.js';
import { ConversationSchema } from './messaging.js';
import { embeddedJsonSchema, pointerSegment } from './embedded-json-schema.js';
export type SocialPathOptions = {
  page?: boolean;
  key?: boolean;
  revision?: boolean;
  etag?: boolean;
  query?: Record<string, unknown>;
};
type Options = SocialPathOptions;
const activityActions: Record<string, string[]> = {
  '/lifecycle/{action}': ['cancel', 'close'],
  '/succession/{action}': ['accept', 'decline', 'cancel'],
  '/expenses/{expenseId}/decisions/{action}': ['approve', 'reject', 'withdraw'],
  '/settlements/{settlementId}/decisions/{action}': [
    'confirm',
    'dispute',
    'cancel',
  ],
};
/** Shared Social operation builder; `{action}` path values come from `actions`. */
export function socialPathBuilder(
  paths: Record<string, Record<string, unknown>>,
  operationPrefix: string,
  actions: Record<string, string[]>,
  text: { success: string; absent: string },
) {
  return function add(
    path: string,
    method: string,
    output: z.ZodType,
    input?: z.ZodType,
    options: Options = {},
  ) {
    const route = '/api/v1' + path,
      pointer = `#/paths/${pointerSegment(route)}/${method}`,
      success = method === 'post' ? 201 : 200;
    const json = (v: z.ZodType, at: string) =>
      embeddedJsonSchema(
        z.toJSONSchema(v, { target: 'draft-2020-12', io: 'input' }),
        at,
      );
    const parameters: unknown[] = [];
    for (const match of path.matchAll(/\{(\w+)\}/g)) {
      const values =
        match[1] === 'action'
          ? Object.entries(actions).find(([suffix]) =>
              path.endsWith(suffix),
            )![1]
          : null;
      parameters.push({
        in: 'path',
        name: match[1],
        required: true,
        schema: values
          ? { type: 'string', enum: values }
          : { type: 'string', format: 'uuid' },
      });
    }
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
    for (const [name, schema] of Object.entries(options.query ?? {}))
      parameters.push({ in: 'query', name, schema });
    if (method !== 'get')
      parameters.push({
        in: 'header',
        name: 'Origin',
        required: true,
        schema: { type: 'string', format: 'uri' },
      });
    if (options.key)
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
        description: text.success,
        headers: {
          'Cache-Control': { schema: { type: 'string', const: 'no-store' } },
          ...(options.etag ? { ETag: { schema: { type: 'string' } } } : {}),
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
    for (const status of [400, 401, 403, 404, 409, 413, 422, 429, 500, 503])
      responses[status] = {
        description: status === 404 ? text.absent : 'Safe error',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiError' },
          },
        },
      };
    paths[route] ??= {};
    paths[route]![method] = {
      operationId: operationPrefix + method + path.replace(/[^a-zA-Z]/g, ''),
      tags: ['social'],
      security: [{ sessionCookie: [] }],
      parameters,
      responses,
      ...(input
        ? {
            requestBody: {
              required: input !== SocialEmptySchema,
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
}
/** P6-02/P6-03 Activity and recordkeeping-only expense operations. */
export function socialActivityPaths(): Record<string, Record<string, unknown>> {
  const paths: Record<string, Record<string, unknown>> = {};
  const add = socialPathBuilder(paths, 'socialActivity', activityActions, {
    success:
      'Authorized P6-02/P6-03 result; records never move money or grant Group access',
    absent:
      'Safe absence; unauthorized Activity or ledger data is indistinguishable',
  });
  const empty = SocialEmptySchema,
    write = { key: true },
    edit = { key: true, revision: true, etag: true },
    a = '/social-activities/{id}';
  add('/social-activities', 'get', c.SocialActivityPageSchema, undefined, {
    page: true,
    query: { groupId: { type: 'string', format: 'uuid' } },
  });
  add(
    '/social-activities',
    'post',
    c.SocialActivitySchema,
    c.SocialActivityCreateSchema,
    { ...write, etag: true },
  );
  add(
    '/social-activities/calendar',
    'get',
    c.SocialActivityCalendarSchema,
    undefined,
    {
      query: {
        from: { type: 'string', format: 'date-time' },
        to: { type: 'string', format: 'date-time' },
      },
    },
  );
  add(a, 'get', c.SocialActivitySchema, undefined, { etag: true });
  add(a, 'patch', c.SocialActivitySchema, c.SocialActivityPatchSchema, edit);
  add(a + '/lifecycle/{action}', 'post', c.SocialActivitySchema, empty, edit);
  add(a + '/join', 'post', c.SocialActivitySchema, empty, write);
  add(
    a + '/rsvp',
    'post',
    c.SocialActivitySchema,
    c.SocialActivityRsvpSchema,
    write,
  );
  add(a + '/leave', 'post', c.SocialActivitySchema, empty, write);
  add(
    a + '/participants',
    'get',
    c.SocialActivityParticipantPageSchema,
    undefined,
    { page: true },
  );
  add(
    a + '/invitations',
    'post',
    c.SocialActivityParticipantSchema,
    c.SocialActivityInviteSchema,
    write,
  );
  add(
    a + '/participants/{participantId}/remove',
    'post',
    c.SocialActivityParticipantSchema,
    empty,
    edit,
  );
  add(
    a + '/participants/{participantId}/role',
    'put',
    c.SocialActivityParticipantSchema,
    c.SocialActivityRoleSchema,
    edit,
  );
  add(a + '/items', 'get', c.SocialActivityItemPageSchema, undefined, {
    page: true,
  });
  add(
    a + '/items',
    'post',
    c.SocialActivityItemSchema,
    c.SocialActivityItemCreateSchema,
    { ...write, etag: true },
  );
  add(
    a + '/items/{itemId}',
    'patch',
    c.SocialActivityItemSchema,
    c.SocialActivityItemPatchSchema,
    edit,
  );
  add(a + '/items/{itemId}', 'delete', c.SocialActivityItemSchema, empty, edit);
  add(
    a + '/items/{itemId}/task',
    'post',
    c.SocialActivityTaskLinkSchema,
    empty,
    write,
  );
  add(a + '/polls', 'get', c.SocialActivityPollPageSchema, undefined, {
    page: true,
  });
  add(
    a + '/polls',
    'post',
    c.SocialActivityPollSchema,
    c.SocialActivityPollCreateSchema,
    { ...write, etag: true },
  );
  add(
    a + '/polls/{pollId}/vote',
    'put',
    c.SocialActivityPollSchema,
    c.SocialActivityVoteSchema,
    write,
  );
  add(
    a + '/polls/{pollId}/close',
    'post',
    c.SocialActivityPollSchema,
    c.SocialActivityPollCloseSchema,
    edit,
  );
  add(a + '/free-busy', 'get', c.SocialActivityBusySchema);
  add(a + '/free-busy', 'put', c.SocialActivityBusyShareSchema, empty, write);
  add(
    a + '/free-busy',
    'delete',
    c.SocialActivityParticipationSchema,
    empty,
    write,
  );
  add(
    a + '/conversation',
    'put',
    c.SocialActivitySchema,
    c.SocialActivityConversationSchema,
    edit,
  );
  add(
    a + '/reminder',
    'put',
    c.SocialActivityParticipationSchema,
    c.SocialActivityReminderSchema,
    write,
  );
  // ADR 0060 succession, deletion with 30-day recovery; ADR 0062 managed chat.
  add(a, 'delete', c.SocialActivitySchema, empty, edit);
  add(a + '/restore', 'post', c.SocialActivitySchema, empty, edit);
  add(
    a + '/items/{itemId}/restore',
    'post',
    c.SocialActivityItemSchema,
    empty,
    edit,
  );
  add(
    a + '/succession',
    'post',
    c.SocialActivitySchema,
    c.SocialActivitySuccessionSchema,
    edit,
  );
  add(a + '/succession/{action}', 'post', c.SocialActivitySchema, empty, edit);
  add(
    a + '/conversation/open',
    'post',
    c.SocialActivitySchema,
    c.SocialActivityConversationOpenSchema,
    edit,
  );
  add(a + '/conversation/join', 'post', ConversationSchema, empty, write);
  add('/social-notices', 'get', c.SocialNoticePageSchema, undefined, {
    page: true,
  });
  add('/social-notices/{id}/read', 'post', c.SocialNoticeSchema, empty, write);
  for (const base of ['/social-groups/{id}', a]) {
    add(base + '/expenses', 'get', c.SocialExpensePageSchema, undefined, {
      page: true,
    });
    add(
      base + '/expenses',
      'post',
      c.SocialExpenseSchema,
      c.SocialExpenseCreateSchema,
      { ...write, etag: true },
    );
    add(
      base + '/expenses/{expenseId}',
      'get',
      c.SocialExpenseSchema,
      undefined,
      { etag: true },
    );
    add(
      base + '/expenses/{expenseId}/history',
      'get',
      c.SocialExpenseHistorySchema,
    );
    add(
      base + '/expenses/{expenseId}/revisions',
      'post',
      c.SocialExpenseSchema,
      c.SocialExpenseInputSchema,
      edit,
    );
    add(
      base + '/expenses/{expenseId}/decisions/{action}',
      'post',
      c.SocialExpenseSchema,
      c.SocialExpenseDecisionSchema,
      edit,
    );
    add(base + '/balances', 'get', c.SocialBalanceListSchema);
    add(base + '/balances/me', 'get', c.SocialBalanceListSchema);
    add(base + '/settlements', 'get', c.SocialSettlementPageSchema, undefined, {
      page: true,
    });
    add(
      base + '/settlements',
      'post',
      c.SocialSettlementSchema,
      c.SocialSettlementCreateSchema,
      { ...write, etag: true },
    );
    add(
      base + '/settlements/{settlementId}/decisions/{action}',
      'post',
      c.SocialSettlementSchema,
      c.SocialSettlementDecisionSchema,
      edit,
    );
    // ADR 0061: explicit, Finance-owned posting of the caller's own effective share.
    add(
      base + '/expenses/{expenseId}/finance-posting/preview',
      'post',
      c.SocialFinancePostingPreviewSchema,
      c.SocialFinancePostingRequestSchema,
    );
    add(
      base + '/expenses/{expenseId}/finance-posting',
      'post',
      c.SocialFinancePostingResultSchema,
      c.SocialFinancePostingConfirmSchema,
      write,
    );
  }
  return paths;
}
