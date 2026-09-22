import type { ModuleGraph, ModuleId } from "../types.ts";

export interface Cycle {
  modules: readonly ModuleId[];
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function findCycles(graph: ModuleGraph): readonly Cycle[] {
  const nodes = [...graph.nodes.keys()].sort(compareStrings);
  const adjacency = new Map<ModuleId, ModuleId[]>();

  for (const node of nodes) {
    adjacency.set(node, []);
  }

  for (const edge of graph.edges) {
    if (edge.status !== "internal" || edge.to === undefined) {
      continue;
    }
    const targets = adjacency.get(edge.from);
    if (targets && !targets.includes(edge.to)) {
      targets.push(edge.to);
    }
  }

  for (const targets of adjacency.values()) {
    targets.sort(compareStrings);
  }

  const cycles: Cycle[] = [];

  for (const start of nodes) {
    const path: ModuleId[] = [start];
    const visited = new Set<ModuleId>(path);

    const visit = (current: ModuleId): void => {
      for (const next of adjacency.get(current) ?? []) {
        if (next === start) {
          cycles.push({ modules: [...path] });
          continue;
        }

        if (compareStrings(next, start) < 0 || visited.has(next)) {
          continue;
        }

        visited.add(next);
        path.push(next);
        visit(next);
        path.pop();
        visited.delete(next);
      }
    };

    visit(start);
  }

  cycles.sort((left, right) => {
    const leftKey = left.modules.join("\u0000");
    const rightKey = right.modules.join("\u0000");
    return compareStrings(leftKey, rightKey);
  });

  return cycles;
}
