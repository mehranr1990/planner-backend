import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as c from '@mehran/api-contracts';
import {
  messagingMediaOperations,
  messagingMediaPaths,
} from '../../../../packages/api-contracts/src/messaging-media-openapi.js';
describe('P5-03 additive media and private notification contracts', () => {
  it('documents 25 protected REST operations with private binary transfers', () => {
    expect(messagingMediaOperations).toHaveLength(25);
    const paths = messagingMediaPaths() as Record<
      string,
      Record<
        string,
        { security: unknown; requestBody?: unknown; responses: unknown }
      >
    >;
    for (const operation of messagingMediaOperations)
      expect(
        paths['/api/v1' + operation.path]![operation.method]!.security,
      ).toBeDefined();
    const upload = JSON.stringify(
      paths['/api/v1/conversations/{id}/attachments/{attachmentId}/complete'],
    );
    expect(upload).toContain('application/octet-stream');
    expect(upload).toContain('415');
    const download = JSON.stringify(
      paths[
        '/api/v1/conversations/{id}/media-messages/{messageId}/attachments/{attachmentId}/download'
      ],
    );
    expect(download).toContain('application/octet-stream');
    expect(download).toContain('Content-Disposition');
  });
  it('rejects client audio duration, excess voice bytes, unsafe filenames and foreign actor input', () => {
    const voice = {
      id: randomUUID(),
      kind: 'VOICE',
      filename: 'voice.wav',
      mimeType: 'audio/wav',
      expectedSize: 10000000,
    };
    expect(c.MessageAttachmentUploadSchema.safeParse(voice).success).toBe(true);
    for (const patch of [
      { expectedSize: 10000001 },
      { durationMs: 1 },
      { filename: '../voice.wav' },
      { mimeType: 'audio/webm' },
      { ownerUserId: randomUUID() },
    ])
      expect(
        c.MessageAttachmentUploadSchema.safeParse({ ...voice, ...patch })
          .success,
      ).toBe(false);
    expect(
      c.MessageAcknowledgeSchema.safeParse({
        messageId: randomUUID(),
        state: 'READ',
        memberId: randomUUID(),
      }).success,
    ).toBe(false);
  });
  it('rejects ambiguous quiet intervals and legacy receipt activity fields', () => {
    const quiet = {
      mode: 'ALL',
      quietStart: '22:00',
      quietEnd: '06:00',
      mentionQuiet: false,
    };
    expect(c.MessageNoticeSettingsInputSchema.safeParse(quiet).success).toBe(
      true,
    );
    for (const patch of [
      { quietEnd: null },
      { quietStart: '25:00' },
      { quietEnd: '22:00' },
      { lastSeen: new Date().toISOString() },
    ])
      expect(
        c.MessageNoticeSettingsInputSchema.safeParse({ ...quiet, ...patch })
          .success,
      ).toBe(false);
    expect(
      c.MessagingPushConsentSchema.safeParse({
        enabled: true,
        subscriptionId: randomUUID(),
      }).success,
    ).toBe(false);
  });
  it('requires actual attachment IDs, bounded unique links and a strict rich message shape', () => {
    const attachment = randomUUID(),
      body = {
        id: randomUUID(),
        caption: null,
        attachments: [attachment],
        mentions: [],
      };
    expect(c.MediaMessageCreateSchema.safeParse(body).success).toBe(true);
    for (const attachments of [
      [],
      [attachment, attachment],
      Array.from({ length: 6 }, () => randomUUID()),
    ])
      expect(
        c.MediaMessageCreateSchema.safeParse({ ...body, attachments }).success,
      ).toBe(false);
    expect(
      c.MediaMessageCreateSchema.safeParse({
        ...body,
        text: 'fake placeholder',
      }).success,
    ).toBe(false);
  });
});
