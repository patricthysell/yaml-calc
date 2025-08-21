export class DepGraph {
  private edges = new Map<string, Set<string>>();
  addNode(node: string) {
    if (!this.edges.has(node)) this.edges.set(node, new Set());
  }
  addDep(node: string, dep: string) {
    this.addNode(node);
    this.addNode(dep);
    this.edges.get(node)!.add(dep);
  }
  topoSort(): string[] {
    const inDeg = new Map<string, number>();
    for (const [n, deps] of this.edges) {
      if (!inDeg.has(n)) inDeg.set(n, 0);
      for (const d of deps) inDeg.set(d, (inDeg.get(d) || 0) + 1);
    }
    const q = [...[...this.edges.keys()].filter(n => (inDeg.get(n) || 0) === 0)];
    const res: string[] = [];
    while (q.length) {
      const n = q.shift()!;
      res.push(n);
      for (const d of this.edges.get(n) || []) {
        inDeg.set(d, (inDeg.get(d) || 0) - 1);
        if ((inDeg.get(d) || 0) === 0) q.push(d);
      }
    }
    if (res.length !== this.edges.size) throw new Error("Dependency cycle detected");
    return res;
  }
}
