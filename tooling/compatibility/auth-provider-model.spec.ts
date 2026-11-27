import { describe, it, expect } from 'vitest';
import { normalizedAuthModel } from '../testing/auth-provider-model.js';
describe('provider auth schema ownership', () => {
  const provider =
    'model User {\n id String @id\n email String\n @@unique([email])\n}\n';
  it('excludes exactly approved application inverse relations without treating them as auth-column drift', () => {
    const extended = provider.replace(
      ' id String',
      ' systemEmailObservations SystemEmailObservation[]\n socialRequestsSent SocialConnection[] @relation("SocialConnection_requester")\n receivedDmBlocks DmContactBlock[] @relation("DmContactBlock_target_fk")\n invitationPushAttempts InvitationPushAttempt[]\n id String',
    );
    expect(normalizedAuthModel(extended, 'User')).toBe(
      normalizedAuthModel(provider, 'User'),
    );
  });
  it('does not ignore changed auth scalar types, indexes, unknown fields or relations with altered ownership', () => {
    expect(() =>
      normalizedAuthModel(
        provider.replace(
          ' id String',
          ' systemEmailObservations String\n id String',
        ),
        'User',
      ),
    ).toThrow('Unreviewed');
    for (const mutation of [
      provider.replace('email String', 'email Int'),
      provider.replace('@@unique([email])', '@@index([email])'),
      provider.replace(' id String', ' unknownField String\n id String'),
    ])
      expect(normalizedAuthModel(mutation, 'User')).not.toBe(
        normalizedAuthModel(provider, 'User'),
      );
    expect(() =>
      normalizedAuthModel(
        provider.replace(
          ' id String',
          ' socialRequestsSent String\n id String',
        ),
        'User',
      ),
    ).toThrow('Unreviewed');
    expect(() =>
      normalizedAuthModel(
        provider.replace(
          ' id String',
          ' invitationPushAttempts String\n id String',
        ),
        'User',
      ),
    ).toThrow('Unreviewed');
  });
  it('accepts only the three exact commercial inverse relations and rejects changed ownership', () => {
    const additions =
      ' r_CommerceFinancialGrant_userId CommerceFinancialGrant[] @relation("CommerceFinancialGrant_userId")\n r_CommerceEvent_actorUserId CommerceEvent[] @relation("CommerceEvent_actorUserId")\n r_CommerceReceipt_userId CommerceReceipt[] @relation("CommerceReceipt_userId")\n';
    expect(
      normalizedAuthModel(
        provider.replace(' id String', additions + ' id String'),
        'User',
      ),
    ).toBe(normalizedAuthModel(provider, 'User'));
    expect(() =>
      normalizedAuthModel(
        provider.replace(
          ' id String',
          additions.replace('CommerceReceipt_userId")', 'wrong_owner")') +
            ' id String',
        ),
        'User',
      ),
    ).toThrow('Unreviewed');
  });
  it('accepts only the three exact commercial inverse relations and rejects changed ownership', () => {
    const additions =
      ' r_CommerceFinancialGrant_userId CommerceFinancialGrant[] @relation("CommerceFinancialGrant_userId")\n r_CommerceEvent_actorUserId CommerceEvent[] @relation("CommerceEvent_actorUserId")\n r_CommerceReceipt_userId CommerceReceipt[] @relation("CommerceReceipt_userId")\n';
    expect(
      normalizedAuthModel(
        provider.replace(' id String', additions + ' id String'),
        'User',
      ),
    ).toBe(normalizedAuthModel(provider, 'User'));
    expect(() =>
      normalizedAuthModel(
        provider.replace(
          ' id String',
          additions.replace('CommerceReceipt_userId")', 'wrong_owner")') +
            ' id String',
        ),
        'User',
      ),
    ).toThrow('Unreviewed');
  });
});
