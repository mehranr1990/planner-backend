import 'reflect-metadata';
import { expect, it, vi } from 'vitest';
import { InvitationMailService } from './invitation-mail.service.js';
import type { IdentityMailService } from '../../../platform/auth/mail.service.js';
import type { DatabaseService } from '../../../platform/database/database.service.js';
import type { AppConfig } from '../../../bootstrap/environment.js';
const proof = 'a'.repeat(43);
function fixture(url?: string, fails = false) {
  const send = fails
    ? vi.fn().mockRejectedValue(new Error('provider failure'))
    : vi.fn().mockResolvedValue(undefined);
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  return {
    send,
    updateMany,
    service: new InvitationMailService(
      { NODE_ENV: 'test', INVITATION_ACCEPT_URL: url } as AppConfig,
      { send } as unknown as IdentityMailService,
      {
        client: { contextInvitation: { updateMany } },
      } as unknown as DatabaseService,
    ),
  };
}
it('uses a fragment proof and persists only safe delivery metadata after SMTP acceptance', async () => {
  const f = fixture('https://planner.example/invitations');
  await f.service.deliver('offer-id', 'recipient@example.test', proof);
  const url = new URL(f.send.mock.calls[0]![0].url);
  expect(url.search).toBe('');
  expect(new URLSearchParams(url.hash.slice(1)).get('proof')).toBe(proof);
  expect(f.updateMany.mock.calls[0]![0].data.emailDeliveryState).toBe('SENT');
  expect(JSON.stringify(f.updateMany.mock.calls)).not.toContain(proof);
});
it('keeps pending offers safe on unavailable configuration or provider rejection', async () => {
  for (const [f, state] of [
    [fixture(), 'UNAVAILABLE'],
    [fixture('https://planner.example/invitations', true), 'FAILED'],
  ] as const) {
    await expect(
      f.service.deliver('offer-id', 'recipient@example.test', proof),
    ).resolves.toBeUndefined();
    expect(f.updateMany.mock.calls[0]![0].data).toEqual({
      emailDeliveryState: state,
    });
  }
});
