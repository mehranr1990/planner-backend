import { it, expect } from 'vitest';
import { RECOVERY_MS } from './activities.service.js';

it('recovers deleted social activities and items for exactly 7 days (ADR 0069)', () => {
  expect(RECOVERY_MS).toBe(7 * 86400000);
});
