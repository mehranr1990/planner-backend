import { describe, expect, it } from 'vitest';
import {
  emailFailure,
  smtpReceipt,
  safeProviderReference,
} from './email-evidence.js';
describe('safe SMTP evidence', () => {
  it('requires actual recipient acceptance and never interprets success as inbox delivery', () => {
    expect(
      smtpReceipt(
        {
          accepted: ['USER@example.test'],
          messageId: '<opaque@provider.test>',
        },
        'user@example.test',
      ),
    ).toEqual({
      state: 'SMTP_ACCEPTED',
      code: 'SMTP_ACCEPTED',
      providerReference: '<opaque@provider.test>',
    });
    expect(smtpReceipt({}, 'user@example.test').state).toBe('UNKNOWN');
    expect(
      smtpReceipt({ accepted: ['other@example.test'] }, 'user@example.test')
        .state,
    ).toBe('UNKNOWN');
    expect(
      smtpReceipt(
        { rejected: ['user@example.test'], response: 'private token' },
        'user@example.test',
      ),
    ).toEqual({ state: 'FAILED', code: 'SMTP_REJECTED' });
  });
  it('sanitizes failures and rejects secret-bearing or control-character provider references', () => {
    expect(
      emailFailure({
        responseCode: 550,
        message: 'private-token@example.test',
      }),
    ).toEqual({ state: 'FAILED', code: 'SMTP_REJECTED' });
    expect(emailFailure({ responseCode: 451 })).toEqual({
      state: 'FAILED',
      code: 'SMTP_TEMPORARY',
    });
    expect(emailFailure(new Error('secret SMTP credentials'))).toEqual({
      state: 'UNKNOWN',
      code: 'SMTP_ACCEPTANCE_UNKNOWN',
    });
    for (const ref of [
      'https://private.test/?token=secret',
      'secret\r\nvalue',
      'x'.repeat(255),
      null,
    ])
      expect(safeProviderReference(ref)).toBeUndefined();
  });
});
