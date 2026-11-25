import { expect, it, vi } from 'vitest';
import type { Prisma } from '../../../generated/prisma/client.js';
import { invitationChannels } from './invitation-preferences.js';
function tx(value: unknown) {
  return {
    notificationPreference: { findFirst: vi.fn().mockResolvedValue(value) },
  } as unknown as Prisma.TransactionClient;
}
it('defaults verified recipients to in-app only without changing legacy matrices', async () => {
  expect(await invitationChannels(tx(null), 'recipient', 'PROJECTS')).toEqual({
    inApp: true,
    email: false,
    webPush: false,
  });
});
it('requires both global and module consent, with separate messaging push consent', async () => {
  const value = {
    inApp: true,
    email: true,
    webPush: true,
    messagingWebPush: false,
    moduleChannels: {
      PROJECTS: { IN_APP: false, EMAIL: true, WEB_PUSH: true },
      MESSAGING_MEETINGS: { IN_APP: true, EMAIL: false, WEB_PUSH: true },
    },
  };
  expect(await invitationChannels(tx(value), 'recipient', 'PROJECTS')).toEqual({
    inApp: false,
    email: true,
    webPush: true,
  });
  expect(
    await invitationChannels(tx(value), 'recipient', 'MESSAGING_MEETINGS'),
  ).toEqual({ inApp: true, email: false, webPush: false });
});
