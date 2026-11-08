import * as c from './messaging-media.js';
import {
  ConversationPageQuerySchema,
  ConversationEmptySchema,
} from './messaging.js';
import { MessageSearchQuerySchema } from './advanced-messaging.js';
import {
  messagingOperationPaths,
  type Operation,
} from './messaging-openapi.js';
export const messagingMediaOperations: Operation[] = [
  {
    path: '/conversations/{id}/attachments',
    method: 'post',
    input: c.MessageAttachmentUploadSchema,
    output: c.MessageAttachmentSchema,
    key: true,
  },
  {
    path: '/conversations/{id}/attachments/{attachmentId}',
    method: 'get',
    output: c.MessageAttachmentSchema,
  },
  {
    path: '/conversations/{id}/attachments/{attachmentId}/complete',
    method: 'post',
    input: ConversationEmptySchema,
    output: c.MessageAttachmentSchema,
    binary: true,
  },
  {
    path: '/conversations/{id}/attachments/{attachmentId}/cancel',
    method: 'post',
    input: ConversationEmptySchema,
    output: c.MessageAttachmentSchema,
    revision: true,
  },
  {
    path: '/conversations/{id}/media-messages',
    method: 'post',
    input: c.MediaMessageCreateSchema,
    output: c.RichMessageSchema,
    key: true,
  },
  {
    path: '/conversations/{id}/media-forwards',
    method: 'post',
    input: c.MediaForwardSchema,
    output: c.RichMessageSchema,
    key: true,
  },
  {
    path: '/conversations/{id}/media-messages/{messageId}',
    method: 'get',
    output: c.RichMessageSchema,
    etag: true,
  },
  {
    path: '/conversations/{id}/media-messages/{messageId}',
    method: 'patch',
    input: c.MediaMessageEditSchema,
    output: c.RichMessageSchema,
    key: true,
    revision: true,
  },
  {
    path: '/conversations/{id}/media-timeline',
    method: 'get',
    query: ConversationPageQuerySchema,
    output: c.RichMessagePageSchema,
  },
  {
    path: '/conversations/{id}/media-changes',
    method: 'get',
    query: ConversationPageQuerySchema,
    output: c.RichMessageChangesSchema,
  },
  {
    path: '/conversations/{id}/media-search',
    method: 'get',
    query: MessageSearchQuerySchema,
    output: c.RichMessagePageSchema,
  },
  {
    path: '/conversations/{id}/media-threads/{messageId}',
    method: 'get',
    query: ConversationPageQuerySchema,
    output: c.RichMessagePageSchema,
  },
  {
    path: '/conversations/{id}/media-messages/{messageId}/revisions',
    method: 'get',
    query: ConversationPageQuerySchema,
    output: c.MessageMediaRevisionPageSchema,
  },
  {
    path: '/conversations/{id}/media-messages/{messageId}/attachments/{attachmentId}/download',
    method: 'get',
    output: ConversationEmptySchema,
    download: true,
  },
  {
    path: '/conversations/{id}/progress',
    method: 'get',
    output: c.MessageProgressSchema,
  },
  {
    path: '/conversations/{id}/acknowledgements',
    method: 'post',
    input: c.MessageAcknowledgeSchema,
    output: c.MessageProgressSchema,
    key: true,
  },
  {
    path: '/conversations/{id}/receipt-settings',
    method: 'patch',
    input: c.MessageReceiptSettingsInputSchema,
    output: c.MessageProgressSchema,
    key: true,
    revision: true,
  },
  {
    path: '/conversations/{id}/messages/{messageId}/receipts',
    method: 'get',
    output: c.MessageReceiptSummarySchema,
  },
  {
    path: '/conversations/{id}/notification-settings',
    method: 'get',
    output: c.MessageNoticeSettingsSchema,
  },
  {
    path: '/conversations/{id}/notification-settings',
    method: 'patch',
    input: c.MessageNoticeSettingsInputSchema,
    output: c.MessageNoticeSettingsSchema,
    key: true,
    revision: true,
  },
  {
    path: '/messaging-notifications/settings',
    method: 'get',
    output: c.MessagingPushSettingsSchema,
  },
  {
    path: '/messaging-notifications/settings',
    method: 'patch',
    input: c.MessagingPushConsentSchema,
    output: c.MessagingPushSettingsSchema,
    key: true,
    revision: true,
  },
  {
    path: '/messaging-notifications',
    method: 'get',
    query: ConversationPageQuerySchema,
    output: c.MessageNoticePageSchema,
  },
  {
    path: '/messaging-notifications/{noticeId}/read',
    method: 'post',
    input: ConversationEmptySchema,
    output: c.MessageNoticeSchema,
    revision: true,
  },
  {
    path: '/messaging-notifications/{noticeId}/deliveries',
    method: 'get',
    output: c.MessagePushAttemptsSchema,
  },
];
export function messagingMediaPaths() {
  return messagingOperationPaths(messagingMediaOperations);
}
