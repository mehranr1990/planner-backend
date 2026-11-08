import { describe, it, expect } from 'vitest';
import { managesChannel, sameAdmission } from './messaging-policy.js';
describe('P5-01 separate participant and source authority', () => {
  it('uses the approved initial source administration catalogs', () => {
    for (const kind of ['PROJECT', 'TEAM', 'COMPANY']) {
      expect(managesChannel(kind, 'OWNER')).toBe(true);
      expect(
        managesChannel(kind, kind === 'COMPANY' ? 'ORG_ADMIN' : 'ADMIN'),
      ).toBe(true);
      for (const role of [
        'MANAGER',
        'LEAD',
        'MEMBER',
        'VIEWER',
        'DEPT_MANAGER',
        'TEAM_LEAD',
        null,
      ])
        expect(managesChannel(kind, role)).toBe(false);
    }
  });
  it('rejects membership reuse after rejoin or restore and never equates an actor with admission', () => {
    const member = {
      sourceAccessId: 'a',
      sourceGeneration: 1,
      restoreGeneration: 0,
    };
    expect(
      sameAdmission(member, {
        accessId: 'a',
        generation: 1,
        restoreGeneration: 0,
      }),
    ).toBe(true);
    expect(
      sameAdmission(member, {
        accessId: 'a',
        generation: 2,
        restoreGeneration: 0,
      }),
    ).toBe(false);
    expect(
      sameAdmission(member, {
        accessId: 'b',
        generation: 1,
        restoreGeneration: 0,
      }),
    ).toBe(false);
    expect(
      sameAdmission(member, {
        accessId: 'a',
        generation: 1,
        restoreGeneration: 1,
      }),
    ).toBe(false);
  });
});
