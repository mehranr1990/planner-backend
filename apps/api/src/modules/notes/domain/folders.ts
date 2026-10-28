/** Validate the complete resulting same-space folder graph, including moved descendants. */
export function validFolders(
  nodes: Array<{ id: string; parentId: string | null }>,
  maxDepth: number,
): boolean {
  const parents = new Map(nodes.map((n) => [n.id, n.parentId]));
  for (const node of nodes) {
    let id: string | null = node.id;
    const path = new Set<string>();
    while (id !== null) {
      if (path.has(id) || !parents.has(id)) return false;
      path.add(id);
      if (path.size > maxDepth) return false;
      id = parents.get(id)!;
    }
  }
  return true;
}
