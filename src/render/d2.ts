import type { ModuleGraph } from "../types.js";

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function renderD2(graph: ModuleGraph): string {
  const nodes = [...graph.nodes.keys()].sort(compareStrings);
  const ids = new Map(nodes.map((module, index) => [module, `n${index}`]));
  const lines = nodes.map((module) => {
    const nodeId = ids.get(module) ?? "";
    return `${nodeId}: ${JSON.stringify(module)}`;
  });
  const edges: string[] = [];

  for (const edge of graph.edges) {
    if (edge.status !== "internal" || edge.to === undefined) {
      continue;
    }
    const from = ids.get(edge.from);
    const to = ids.get(edge.to);
    if (from && to) {
      edges.push(`${from} -> ${to}`);
    }
  }

  return [...lines, ...(lines.length > 0 && edges.length > 0 ? [""] : []), ...edges].join("\n");
}
