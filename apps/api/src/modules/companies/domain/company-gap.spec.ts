import { describe, it, expect } from 'vitest';
import {
  activeWindow,
  observedMilliseconds,
  normalizedAssetTag,
} from './company-gap.js';
describe('Company gap invariants', () => {
  it('clips and unions overlapping evidence without counting adjacent periods twice', () => {
    expect(
      observedMilliseconds(
        [
          { from: -5, to: 20 },
          { from: 10, to: 30 },
          { from: 30, to: 40 },
          { from: 80, to: 120 },
        ],
        0,
        100,
      ),
    ).toBe(60);
    expect(observedMilliseconds([], 0, 100)).toBe(0);
  });
  it('expires authority synchronously at the boundary regardless of cleanup', () => {
    const row = {
      validFrom: new Date(10),
      expiresAt: new Date(20),
      revokedAt: null,
    };
    expect(activeWindow(row, new Date(9))).toBe(false);
    expect(activeWindow(row, new Date(10))).toBe(true);
    expect(activeWindow(row, new Date(20))).toBe(false);
    expect(
      activeWindow({ ...row, revokedAt: new Date(12) }, new Date(15)),
    ).toBe(false);
  });
  it('does not invent or case-rewrite asset identifiers', () => {
    expect(normalizedAssetTag('  Ab-123  ')).toBe('Ab-123');
  });
});
