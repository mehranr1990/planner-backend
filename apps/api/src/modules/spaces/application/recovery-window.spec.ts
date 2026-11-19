import { it, expect } from 'vitest';
import { recoveryWindowMs } from './shared-kernel.service.js';

it('recovers Company, Team and Project closures for 7 days and keeps 30 for other kinds', () => {
  for (const kind of ['PROJECT', 'TEAM', 'COMPANY'])
    expect(recoveryWindowMs(kind)).toBe(7 * 86400000);
  for (const kind of ['SOCIAL_GROUP', 'CONVERSATION', 'MEETING'])
    expect(recoveryWindowMs(kind)).toBe(30 * 86400000);
});
