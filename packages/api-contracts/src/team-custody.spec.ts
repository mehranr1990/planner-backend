import { describe, it, expect } from 'vitest';
import {
  TeamCustodyPreviewSchema,
  TeamCustodyConsentSchema,
  TeamCustodyTransferSchema,
} from './team-custody.js';
const id = '00000000-0000-4000-8000-000000000001';
describe('narrow one-way Team custody boundary', () => {
  it('rejects transfer directions, creator/owner assignments and consent shortcuts in preview input', () => {
    const valid = { companyId: id, parentScopeId: id };
    expect(TeamCustodyPreviewSchema.safeParse(valid).success).toBe(true);
    for (const extra of [
      { detach: true },
      { sourceType: 'COMPANY' },
      { ownerUserId: id },
      { createdByActorId: id },
      { skipConsent: true },
    ])
      expect(
        TeamCustodyPreviewSchema.safeParse({ ...valid, ...extra }).success,
      ).toBe(false);
  });
  it('requires explicit owner/participant purpose and provider proof; excludes internal control evidence from output', () => {
    const consent = {
      manifestHash: 'a'.repeat(64),
      revision: 1,
      password: 'synthetic proof',
      purpose: 'PARTICIPANT',
    };
    expect(TeamCustodyConsentSchema.safeParse(consent).success).toBe(true);
    expect(
      TeamCustodyConsentSchema.safeParse({
        ...consent,
        purpose: 'ADMIN_OVERRIDE',
      }).success,
    ).toBe(false);
    expect(
      TeamCustodyConsentSchema.safeParse({ ...consent, password: '' }).success,
    ).toBe(false);
    expect(
      TeamCustodyTransferSchema.safeParse({
        id,
        teamId: id,
        companyId: id,
        parentScopeId: id,
        state: 'APPLIED',
        revision: 3,
        manifestHash: 'a'.repeat(64),
        expiresAt: '2026-11-24T01:00:00Z',
        appliedAt: '2026-11-24T00:30:00Z',
        retirementControlId: id,
      }).success,
    ).toBe(false);
  });
});
