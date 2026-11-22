import { expect, it } from 'vitest';
import {
  moduleChannelEnabled,
  moduleChannelView,
  filterModuleNotificationUsers,
} from './module-preferences.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import * as c from '@mehran/api-contracts';
it('keeps six modules and three channels independent with compatible inherited defaults', () => {
  const value = { PROJECTS: { IN_APP: false, WEB_PUSH: true, EMAIL: false } };
  expect(moduleChannelEnabled(value, 'PROJECTS', 'IN_APP')).toBe(false);
  expect(moduleChannelEnabled(value, 'PROJECTS', 'WEB_PUSH')).toBe(true);
  expect(moduleChannelEnabled(value, 'TEAMS', 'IN_APP')).toBe(true);
  expect(Object.keys(moduleChannelView({}))).toHaveLength(6);
  expect(
    c.NotificationPreferencePatchSchema.safeParse({
      moduleChannels: { PROJECTS: { TASK_ASSIGNED: true } },
    }).success,
  ).toBe(false);
  expect(
    c.NotificationPreferencePatchSchema.safeParse({
      moduleChannels: { UNKNOWN: value.PROJECTS },
    }).success,
  ).toBe(false);
  expect(moduleChannelEnabled('invalid', 'PERSONAL', 'EMAIL')).toBe(false);
});
it('applies global settings together with module preferences to the authorized recipient list', async () => {
  const tx = {
    notificationPreference: {
      findMany: async () => [
        { ownerUserId: 'global-off', inApp: false, moduleChannels: {} },
        {
          ownerUserId: 'module-off',
          inApp: true,
          moduleChannels: {
            SOCIAL: { IN_APP: false, EMAIL: true, WEB_PUSH: true },
          },
        },
        {
          ownerUserId: 'other-module-off',
          inApp: true,
          moduleChannels: {
            PROJECTS: { IN_APP: false, EMAIL: true, WEB_PUSH: true },
          },
        },
      ],
    },
  } as unknown as Prisma.TransactionClient;
  expect(
    await filterModuleNotificationUsers(
      tx,
      ['global-off', 'module-off', 'other-module-off', 'legacy'],
      'SOCIAL',
    ),
  ).toEqual(['other-module-off', 'legacy']);
});
