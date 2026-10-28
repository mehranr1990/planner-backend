import { describe, it, expect } from 'vitest';
import { validFolders } from './folders.js';
describe('personal note folder containment', () => {
  it('accepts roots and bounded descendants', () =>
    expect(
      validFolders(
        [
          { id: 'a', parentId: null },
          { id: 'b', parentId: 'a' },
        ],
        5,
      ),
    ).toBe(true));
  it('rejects self and indirect cycles', () => {
    expect(validFolders([{ id: 'a', parentId: 'a' }], 5)).toBe(false);
    expect(
      validFolders(
        [
          { id: 'a', parentId: 'b' },
          { id: 'b', parentId: 'a' },
        ],
        5,
      ),
    ).toBe(false);
  });
  it('rejects a parent outside the authorized graph', () =>
    expect(validFolders([{ id: 'a', parentId: 'foreign' }], 5)).toBe(false));
  it('checks descendant depth when moving a subtree', () => {
    const nodes = Array.from({ length: 6 }, (_, i) => ({
      id: String(i),
      parentId: i === 0 ? null : String(i - 1),
    }));
    expect(validFolders(nodes, 5)).toBe(false);
    expect(
      validFolders(
        nodes.map((n) => (n.id === '3' ? { ...n, parentId: null } : n)),
        5,
      ),
    ).toBe(true);
  });
});
