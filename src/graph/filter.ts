import { findCycles } from "./cycles.ts";
import { createGraphBuilder } from "./graph.ts";
import type { ModuleGraph, ModuleNode } from "../types.ts";

export type GraphFilter = (node: ModuleNode) => boolean;

export function filterGraph(graph: ModuleGraph, predicate: GraphFilter): ModuleGraph {
  const builder = createGraphBuilder(graph.rootDir);
  const included = new Set<string>();

  for (const node of graph.nodes.values()) {
    if (predicate(node)) {
      included.add(node.id);
      builder.addNode(node);
    }
  }

  for (const edge of graph.edges) {
    if (!included.has(edge.from)) {
      continue;
    }
    if (edge.status === "internal" && (edge.to === undefined || !included.has(edge.to))) {
      continue;
    }
    builder.addEdge(edge);
  }

  return builder.build();
}

export function cyclicSubgraph(graph: ModuleGraph): ModuleGraph {
  const cyclicModules = new Set(findCycles(graph).flatMap((cycle) => cycle.modules));
  const builder = createGraphBuilder(graph.rootDir);

  for (const [id, node] of graph.nodes) {
    if (cyclicModules.has(id)) {
      builder.addNode(node);
    }
  }

  for (const edge of graph.edges) {
    if (
      edge.status === "internal" &&
      edge.to !== undefined &&
      cyclicModules.has(edge.from) &&
      cyclicModules.has(edge.to)
    ) {
      builder.addEdge(edge);
    }
  }

  return builder.build();
}
