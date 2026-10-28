import { describe, it, expect } from 'vitest';
import { validHierarchy } from './hierarchy.js';
describe('same-space goal hierarchy invariants', () => {
  it('accepts roots and bounded descendants', () => {
    expect(
      validHierarchy(
        [
          { id: 'a', parentGoalId: null },
          { id: 'b', parentGoalId: 'a' },
        ],
        5,
      ),
    ).toBe(true);
  });
  it('rejects self-cycles and indirect cycles', () => {
    expect(validHierarchy([{ id: 'a', parentGoalId: 'a' }], 5)).toBe(false);
    expect(
      validHierarchy(
        [
          { id: 'a', parentGoalId: 'b' },
          { id: 'b', parentGoalId: 'a' },
        ],
        5,
      ),
    ).toBe(false);
  });
  it('rejects parents absent from the authorized space graph', () => {
    expect(validHierarchy([{ id: 'a', parentGoalId: 'foreign' }], 5)).toBe(
      false,
    );
  });
  it('validates descendant depths after subtree moves', () => {
    const nodes = Array.from({ length: 6 }, (_, i) => ({
      id: String(i),
      parentGoalId: i === 0 ? null : String(i - 1),
    }));
    expect(validHierarchy(nodes.slice(0, 5), 5)).toBe(true);
    expect(validHierarchy(nodes, 5)).toBe(false);
    expect(
      validHierarchy(
        nodes.map((n) => (n.id === '3' ? { ...n, parentGoalId: null } : n)),
        5,
      ),
    ).toBe(true);
  });
});
