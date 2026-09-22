import type { ModuleGraph, ModuleId } from "../types.js";

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function internalEdges(graph: ModuleGraph): readonly { from: ModuleId; to: ModuleId }[] {
  return graph.edges.flatMap((edge) =>
    edge.status === "internal" && edge.to !== undefined ? [{ from: edge.from, to: edge.to }] : [],
  );
}

export function findDirectDependencies(graph: ModuleGraph, module: ModuleId): readonly ModuleId[] {
  const dependencies = new Set<ModuleId>();
  for (const edge of internalEdges(graph)) {
    if (edge.from === module) {
      dependencies.add(edge.to);
    }
  }
  return [...dependencies].sort(compareStrings);
}

export function findDirectDependents(graph: ModuleGraph, module: ModuleId): readonly ModuleId[] {
  const dependents = new Set<ModuleId>();
  for (const edge of internalEdges(graph)) {
    if (edge.to === module) {
      dependents.add(edge.from);
    }
  }
  return [...dependents].sort(compareStrings);
}

export function findLeaves(graph: ModuleGraph): readonly ModuleId[] {
  const modulesWithDependencies = new Set(internalEdges(graph).map((edge) => edge.from));
  return [...graph.nodes.keys()]
    .filter((module) => !modulesWithDependencies.has(module))
    .sort(compareStrings);
}

export function findOrphans(graph: ModuleGraph): readonly ModuleId[] {
  const modulesWithDependents = new Set(internalEdges(graph).map((edge) => edge.to));
  return [...graph.nodes.keys()]
    .filter((module) => !modulesWithDependents.has(module))
    .sort(compareStrings);
}
