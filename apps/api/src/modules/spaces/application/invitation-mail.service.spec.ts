import 'reflect-metadata';
import { expect, it, vi } from 'vitest';
import { InvitationMailService } from './invitation-mail.service.js';
import type { IdentityMailService } from '../../../platform/auth/mail.service.js';
import type { DatabaseService } from '../../../platform/database/database.service.js';
import type { AppConfig } from '../../../bootstrap/environment.js';
const proof = 'a'.repeat(43);
function fixture(
  url?: string,
  fails = false,
  recipient?: { emailVerified: boolean; email: boolean },
) {
  const send = fails
    ? vi.fn().mockRejectedValue(new Error('provider failure'))
    : vi.fn().mockResolvedValue(undefined);
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  return {
    send,
    updateMany,
    service: new InvitationMailService(
      {
        NODE_ENV: 'test',
        INVITATION_ACCEPT_URL: url,
        NOTIFICATION_EMAIL_ENABLED: true,
        BETTER_AUTH_SECRET:
          'test-only-invitation-encryption-key-at-least-32-chars',
      } as AppConfig,
      { send } as unknown as IdentityMailService,
      {
        client: {
          user: {
            findUnique: vi.fn().mockResolvedValue(
              recipient
                ? {
                    id: 'recipient-id',
                    email: 'recipient@example.test',
                    emailVerified: recipient.emailVerified,
                  }
                : null,
            ),
          },
          userSettings: {
            findUnique: vi.fn().mockResolvedValue({
              timezone: 'UTC',
              suspendedAt: null,
              suspensionExpiresAt: null,
            }),
          },
          space: {
            findFirst: vi.fn().mockResolvedValue({ id: 'personal-space' }),
          },
          notificationPreference: {
            findFirst: vi.fn().mockResolvedValue({
              inApp: true,
              email: recipient?.email ?? false,
              webPush: false,
              moduleChannels: {},
            }),
          },
          contextInvitation: {
            updateMany,
            findUniqueOrThrow: vi
              .fn()
              .mockResolvedValue({ scopeId: 'scope', companyScopeId: null }),
          },
          accessScope: {
            findUniqueOrThrow: vi.fn().mockResolvedValue({ kind: 'TEAM' }),
          },
        },
      } as unknown as DatabaseService,
    ),
  };
}
it('uses fragment proofs in the worker and queues only encrypted proofs from requests', async () => {
  const f = fixture('https://planner.example/invitations');
  expect(
    await f.service.send('offer-id', 'recipient@example.test', proof),
  ).toBe('SENT');
  await f.service.deliver('offer-id', 'recipient@example.test', proof);
  const url = new URL(f.send.mock.calls[0]![0].url);
  expect(url.search).toBe('');
  expect(new URLSearchParams(url.hash.slice(1)).get('proof')).toBe(proof);
  expect(f.updateMany.mock.calls[0]![0].data.deliveryAttempts).toBe(0);
  expect(
    await f.service.decrypt(
      f.updateMany.mock.calls[0]![0].data.encryptedDeliveryProof,
    ),
  ).toBe(proof);
  expect(JSON.stringify(f.updateMany.mock.calls)).not.toContain(proof);
});
it('keeps pending offers safe on unavailable configuration or provider rejection', async () => {
  for (const [f, state] of [
    [fixture(), 'UNAVAILABLE'],
    [fixture('https://planner.example/invitations', true), 'FAILED'],
  ] as const) {
    await expect(
      f.service.send('offer-id', 'recipient@example.test', proof),
    ).resolves.toBe(state);
  }
});
it('sends to unknown/unverified addresses and requires verified recipient email consent', async () => {
  for (const recipient of [undefined, { emailVerified: false, email: false }]) {
    const f = fixture('https://planner.example/invite', false, recipient);
    expect(
      await f.service.send('offer-id', 'recipient@example.test', proof),
    ).toBe('SENT');
    expect(f.send).toHaveBeenCalledOnce();
  }
  const off = fixture('https://planner.example/invite', false, {
    emailVerified: true,
    email: false,
  });
  expect(
    await off.service.send('offer-id', 'recipient@example.test', proof),
  ).toBe('NONE');
  expect(off.send).not.toHaveBeenCalled();
  const on = fixture('https://planner.example/invite', false, {
    emailVerified: true,
    email: true,
  });
  expect(
    await on.service.send('offer-id', 'recipient@example.test', proof),
  ).toBe('SENT');
});
