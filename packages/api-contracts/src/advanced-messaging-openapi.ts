import * as c from './advanced-messaging.js';
import { ConversationPageQuerySchema } from './messaging.js';
import type { z } from 'zod';
export const advancedMessagingOperations = [
  {
    path: '/conversations/{id}/advanced-actions',
    method: 'post' as const,
    input: c.AdvancedMessageActionSchema,
    output: c.AdvancedMessageResultSchema,
    key: true,
    conditionalRevision: true,
  },
  ...(
    [
      ['timeline', c.AdvancedMessagePageSchema],
      ['message-changes', c.MessageChangesSchema],
      ['threads/{messageId}', c.AdvancedMessagePageSchema],
      ['pins', c.AdvancedMessagePageSchema],
      ['mentions', c.AdvancedMessagePageSchema],
      ['message-reports', c.MessageReportPageSchema],
      ['message-details/{messageId}/revisions', c.MessageRevisionPageSchema],
    ] satisfies [string, z.ZodType][]
  ).map(([path, output]) => ({
    path: '/conversations/{id}/' + path,
    method: 'get' as const,
    query: ConversationPageQuerySchema,
    output,
  })),
  {
    path: '/conversations/{id}/message-search',
    method: 'get' as const,
    query: c.MessageSearchQuerySchema,
    output: c.AdvancedMessagePageSchema,
  },
  {
    path: '/conversations/{id}/message-details/{messageId}',
    method: 'get' as const,
    output: c.AdvancedMessageSchema,
  },
  {
    path: '/conversations/{id}/message-policy',
    method: 'get' as const,
    output: c.MessagePolicySchema,
  },
];
