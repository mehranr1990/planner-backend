/** Validate the resulting hierarchy, including descendants when reparenting a subtree. */
export function validHierarchy(
  nodes: Array<{ id: string; parentGoalId: string | null }>,
  maxDepth: number,
): boolean {
  const parents = new Map(nodes.map((n) => [n.id, n.parentGoalId]));
  for (const node of nodes) {
    const path = new Set<string>();
    let id: string | null = node.id;
    while (id !== null) {
      if (path.has(id) || !parents.has(id)) return false;
      path.add(id);
      if (path.size > maxDepth) return false;
      id = parents.get(id)!;
    }
  }
  return true;
}
