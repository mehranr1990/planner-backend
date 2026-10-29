import { afterEach, describe, it, expect, vi } from 'vitest';
import { createECDH, randomUUID } from 'node:crypto';
import webpush from 'web-push';
import nodemailer from 'nodemailer';
import { parseEnvironment } from '../../../bootstrap/environment.js';
import { ChannelTransport, publicAddress } from './transport.js';
const config = () => {
  const key = createECDH('prime256v1');
  key.generateKeys();
  return parseEnvironment({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://localhost/unused_test',
    BETTER_AUTH_URL: 'http://localhost:3000',
    BETTER_AUTH_SECRET: 'transport-test-only-secret-at-least-32-characters',
    MAIL_MODE: 'smtp',
    SMTP_HOST: 'smtp.example.invalid',
    SMTP_USER: 'test-only',
    SMTP_PASSWORD: 'test-only',
    NOTIFICATION_EMAIL_ENABLED: 'true',
    PUSH_MODE: 'webpush',
    PUSH_VAPID_PUBLIC_KEY: key.getPublicKey().toString('base64url'),
    PUSH_VAPID_PRIVATE_KEY: key.getPrivateKey().toString('base64url'),
    PUSH_VAPID_SUBJECT: 'mailto:owner@example.test',
  });
};
const message = () => {
  const key = createECDH('prime256v1');
  key.generateKeys();
  return {
    deliveryId: randomUUID(),
    notificationId: randomUUID(),
    channel: 'WEB_PUSH' as const,
    subscription: {
      endpoint: 'https://fcm.googleapis.com/fcm/send/test-only',
      keys: {
        auth: Buffer.alloc(16, 9).toString('base64url'),
        p256dh: key.getPublicKey().toString('base64url'),
      },
    },
    title: 'private-marker',
    body: 'private-marker-finance-journal',
  };
};
describe('P1-10 configured external adapters without live provider calls', () => {
  afterEach(() => vi.restoreAllMocks());
  it.each([
    '127.0.0.1',
    '10.20.30.40',
    '172.16.2.3',
    '172.31.255.255',
    '192.168.2.3',
    '169.254.1.1',
    '100.64.1.1',
    '198.18.1.1',
    '224.0.0.1',
    '::1',
    'fe80::1',
    'fc00::1',
    '::ffff:10.0.0.1',
    '2002:0a00:0001::',
    '2001:0:1234::',
  ])('rejects private/local/tunnel address %s', (address) =>
    expect(publicAddress(address)).toBe(false),
  );
  it.each(['142.250.1.1', '172.217.23.234', '192.0.80.1', '2607:f8b0:4000::1'])(
    'accepts public provider address %s',
    (address) => expect(publicAddress(address)).toBe(true),
  );
  it('emits a generic Push payload with opaque IDs, bounded TTL/time and deterministic topic', async () => {
    const send = vi
        .spyOn(webpush, 'sendNotification')
        .mockResolvedValue({ statusCode: 201, headers: {}, body: '' }),
      m = message();
    expect((await new ChannelTransport(config()).send(m)).outcome).toBe(
      'ACCEPTED',
    );
    const args = send.mock.calls[0]!;
    expect(JSON.parse(args[1] as string)).toEqual({
      title: 'Mehran Planner',
      body: 'You have a reminder.',
      notificationId: m.notificationId,
      tag: m.notificationId,
    });
    expect(args[1]).not.toContain('private-marker');
    expect(args[2]).toMatchObject({ TTL: 300, timeout: 10000 });
    expect(args[2]!.topic).toHaveLength(32);
    expect(args[2]!.agent).toBeDefined();
  });
  it.each([
    [404, 'GONE'],
    [410, 'GONE'],
    [429, 'RETRY'],
    [503, 'RETRY'],
    [400, 'FAILED'],
    [0, 'AMBIGUOUS'],
  ] as const)(
    'classifies Push status %i without exposing provider content',
    async (status, outcome) => {
      vi.spyOn(webpush, 'sendNotification').mockRejectedValue({
        statusCode: status,
        message: 'private-marker endpoint key',
      });
      const result = await new ChannelTransport(config()).send(message());
      expect(result.outcome).toBe(outcome);
      expect(JSON.stringify(result)).not.toContain('private-marker');
    },
  );
  it('emits generic SMTP text and a deterministic message ID', async () => {
    const sendMail = vi.fn().mockResolvedValue({}),
      close = vi.fn();
    vi.spyOn(nodemailer, 'createTransport').mockReturnValue({
      sendMail,
      close,
    } as unknown as ReturnType<typeof nodemailer.createTransport>);
    const m = {
      ...message(),
      channel: 'EMAIL' as const,
      email: 'owner@example.test',
    };
    expect((await new ChannelTransport(config()).send(m)).outcome).toBe(
      'ACCEPTED',
    );
    expect(sendMail.mock.calls[0]![0]).toMatchObject({
      to: m.email,
      messageId: '<' + m.deliveryId + '@planner.invalid>',
    });
    expect(JSON.stringify(sendMail.mock.calls)).not.toContain('private-marker');
    expect(close).toHaveBeenCalledOnce();
  });
  it.each([
    [450, 'RETRY'],
    [550, 'FAILED'],
    [0, 'AMBIGUOUS'],
  ] as const)(
    'classifies SMTP status %i without logging provider text',
    async (responseCode, outcome) => {
      vi.spyOn(nodemailer, 'createTransport').mockReturnValue({
        sendMail: vi
          .fn()
          .mockRejectedValue({ responseCode, message: 'private-marker' }),
        close: vi.fn(),
      } as unknown as ReturnType<typeof nodemailer.createTransport>);
      const result = await new ChannelTransport(config()).send({
        ...message(),
        channel: 'EMAIL',
        email: 'owner@example.test',
      });
      expect(result.outcome).toBe(outcome);
      expect(JSON.stringify(result)).not.toContain('private-marker');
    },
  );
});
