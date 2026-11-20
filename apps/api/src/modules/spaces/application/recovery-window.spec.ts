import { it, expect } from 'vitest';
import { RECOVERY_WINDOW_MS } from './shared-kernel.service.js';

it('uses one 7-day recovery window for every shared kind (ADR 0069)', () => {
  expect(RECOVERY_WINDOW_MS).toBe(7 * 86400000);
});
