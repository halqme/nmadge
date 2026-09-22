import type { ModuleGraph } from "../types.js";

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function escapeLabel(label: string): string {
  return label
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\n", "&#10;");
}

export function renderMermaid(graph: ModuleGraph): string {
  const nodes = [...graph.nodes.keys()].sort(compareStrings);
  const ids = new Map(nodes.map((module, index) => [module, `n${index}`]));
  const lines = ["flowchart LR"];

  for (const module of nodes) {
    const nodeId = ids.get(module);
    if (nodeId) {
      lines.push(`  ${nodeId}["${escapeLabel(module)}"]`);
    }
  }

  for (const edge of graph.edges) {
    if (edge.status !== "internal" || edge.to === undefined) {
      continue;
    }
    const from = ids.get(edge.from);
    const to = ids.get(edge.to);
    if (from && to) {
      lines.push(`  ${from} --> ${to}`);
    }
  }

  return lines.join("\n");
}
