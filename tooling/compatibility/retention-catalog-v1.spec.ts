import { describe, it, expect } from 'vitest';
import { SharedRetentionSchema } from '../../apps/api/src/modules/spaces/application/shared-retention.ts';
import { retentionTransition } from '../../apps/api/src/modules/spaces/application/retention-transition.ts';
import {
  RETENTION_CATALOG_V1 as catalog,
  RETENTION_CATALOG_V1_PENDING as pending,
} from '../retention/catalog-v1.ts';

const year = 365 * 86400,
  find = (v: string) => catalog.find((p) => p.policyVersion === v)!,
  longer = (v: string, extra: Partial<Record<string, number>>) => {
    const base = structuredClone(find(v));
    for (const [k, s] of Object.entries(extra))
      base.classRules[
        k as keyof typeof base.classRules
      ].retainAfterClosureSeconds = s!;
    return { ...base, policyVersion: v + '-longer' };
  };
describe('Retention Policy Catalog v1.0', () => {
  it('maps the approved configuration onto valid, distinct, PURGE-only policies', () => {
    expect(catalog.map((p) => p.policyVersion)).toEqual([
      'mp-rpc-v1.0-work',
      'mp-rpc-v1.0-conversation',
      'mp-rpc-v1.0-meeting',
    ]);
    for (const p of catalog) {
      expect(SharedRetentionSchema.parse(p)).toEqual(p);
      expect(p.holds).toEqual([]);
      expect(p.obligations).toEqual([]);
      expect(p.approvalReference).toMatch(
        /production operator approval pending/,
      );
      // Non-CONVERSATION/MEETING lifecycle blocks anything but PURGE.
      for (const r of Object.values(p.classRules))
        expect(r.disposalAction).toBe('PURGE');
      expect(p.classRules.accessAuditLifecycle.retainAfterClosureSeconds).toBe(
        2 * year,
      );
      expect(p.classRules.filesDerivatives.retainAfterClosureSeconds).toBe(0);
    }
    expect(
      find('mp-rpc-v1.0-work').classRules.workContent.retainAfterClosureSeconds,
    ).toBe(0);
    expect(
      find('mp-rpc-v1.0-conversation').classRules.workContent
        .retainAfterClosureSeconds,
    ).toBe(3 * year);
    expect(
      find('mp-rpc-v1.0-meeting').classRules.workContent
        .retainAfterClosureSeconds,
    ).toBe(5 * year);
  });
  it('gives each supported Space type exactly one default and seeds no legal-sensitive or undefined context', () => {
    const contexts = catalog.flatMap((p) => p.applicableContexts);
    expect([...contexts].sort()).toEqual([
      'CONVERSATION',
      'MEETING',
      'PROJECT',
      'TEAM',
    ]);
    expect(contexts).not.toContain('COMPANY');
    expect(contexts).not.toContain('SOCIAL_GROUP');
    expect(pending.map((p) => p.context)).toEqual(['COMPANY', 'SOCIAL_GROUP']);
  });
  it('allows only longer comparable approved policies and refuses decreases, mismatches and inapplicable contexts', () => {
    const work = find('mp-rpc-v1.0-work'),
      up = longer('mp-rpc-v1.0-work', { workContent: year });
    expect(retentionTransition(work, up, 'PROJECT')).toBeNull();
    expect(retentionTransition(up, work, 'PROJECT')).toBe(
      'RETENTION_SHORTENING_FORBIDDEN',
    );
    expect(retentionTransition(work, work, 'TEAM')).toBe(
      'RETENTION_NOT_INCREASED',
    );
    expect(
      retentionTransition(work, find('mp-rpc-v1.0-meeting'), 'PROJECT'),
    ).toBe('RETENTION_NOT_APPLICABLE');
    // A longer meeting class cannot hide a shorter audit window.
    const mixed = longer('mp-rpc-v1.0-meeting', {
      workContent: 6 * year,
      accessAuditLifecycle: year,
    });
    expect(
      retentionTransition(find('mp-rpc-v1.0-meeting'), mixed, 'MEETING'),
    ).toBe('RETENTION_SHORTENING_FORBIDDEN');
    const other = { ...up, marketScope: 'other market' };
    expect(retentionTransition(work, other, 'PROJECT')).toBe(
      'RETENTION_NOT_COMPARABLE',
    );
  });
  it('keeps holds and obligations when moving away from a policy that carries them', () => {
    const held = {
        ...find('mp-rpc-v1.0-conversation'),
        holds: [
          {
            id: '00000000-0000-4000-8000-000000000001',
            basis: 'synthetic',
            authority: 'synthetic',
            scope: 'space',
            nextReviewAt: '2027-01-01T00:00:00.000Z',
            state: 'ACTIVE' as const,
            releaseEvidence: null,
          },
        ],
      },
      up = longer('mp-rpc-v1.0-conversation', { workContent: 4 * year });
    expect(retentionTransition(held, up, 'CONVERSATION')).toBe(
      'RETENTION_HOLD_DROPPED',
    );
    expect(
      retentionTransition(held, { ...up, holds: held.holds }, 'CONVERSATION'),
    ).toBeNull();
  });
});
