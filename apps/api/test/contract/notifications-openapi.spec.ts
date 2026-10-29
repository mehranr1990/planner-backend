import { describe, it, expect } from 'vitest';
import { createOpenApiDocument } from '../../../../packages/api-contracts/src/openapi.js';
import * as c from '@mehran/api-contracts';
import {
  safeEndpoint,
  validPushKeys,
} from '../../src/modules/notifications/infrastructure/transport.js';
import { createECDH } from 'node:crypto';
describe('P1-10 strict private notification contracts', () => {
  it('publishes every approved route family', () => {
    const paths = createOpenApiDocument().paths;
    for (const p of [
      '/reminders',
      '/reminders/{id}/deliveries',
      '/notifications',
      '/notifications/preferences',
      '/notifications/{id}/read',
      '/notifications/{id}/snooze',
      '/push/subscriptions',
      '/notifications/test',
    ])
      expect(paths).toHaveProperty('/api/v1' + p);
  });
  it('rejects ownership, unknown keys and unscoped Task rules', () => {
    for (const body of [
      {
        ownerUserId: crypto.randomUUID(),
        rule: { version: 1, kind: 'ABSOLUTE', at: '2026-01-01T00:00:00Z' },
      },
      { rule: { version: 1, kind: 'TASK', field: 'DUE_AT' } },
      {
        timezoneMode: 'FIXED',
        rule: {
          version: 1,
          kind: 'LOCAL',
          startDate: '2026-01-01',
          time: '12:00',
        },
      },
    ])
      expect(c.ReminderCreateSchema.safeParse(body).success).toBe(false);
  });
  it('requires date-only Task clock context', () =>
    expect(
      c.ReminderRuleSchema.safeParse({
        version: 1,
        kind: 'TASK',
        field: 'SCHEDULED_DATE',
      }).success,
    ).toBe(false));
  it('rejects duplicate channels and empty selected weekdays', () => {
    expect(
      c.ReminderCreateSchema.safeParse({
        rule: { version: 1, kind: 'ABSOLUTE', at: '2026-01-01T00:00:00Z' },
        channels: ['IN_APP', 'IN_APP'],
      }).success,
    ).toBe(false);
    expect(
      c.ReminderScheduleSchema.safeParse({
        version: 1,
        frequency: 'SELECTED_WEEKDAYS',
      }).success,
    ).toBe(false);
  });
  it.each([
    'http://fcm.googleapis.com/x',
    'https://localhost/x',
    'https://127.0.0.1/x',
    'https://fcm.googleapis.com.evil.test/x',
    'https://user@fcm.googleapis.com/x',
    'https://fcm.googleapis.com:8443/x',
    'https://fcm.googleapis.com/x#secret',
  ])('denies unsafe endpoint %s', (value) =>
    expect(safeEndpoint(value)).toBeNull(),
  );
  it('requires valid curve material', () => {
    const key = createECDH('prime256v1');
    key.generateKeys();
    expect(
      validPushKeys({
        auth: Buffer.alloc(16, 1).toString('base64url'),
        p256dh: key.getPublicKey().toString('base64url'),
      }),
    ).toBe(true);
    expect(
      validPushKeys({
        auth: Buffer.alloc(16).toString('base64url'),
        p256dh: Buffer.alloc(65).toString('base64url'),
      }),
    ).toBe(false);
  });
});
