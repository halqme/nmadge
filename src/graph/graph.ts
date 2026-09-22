import type { DependencyEdge, ModuleGraph, ModuleNode } from "../types.ts";

export interface GraphBuilder {
  addNode(node: ModuleNode): void;
  addEdge(edge: DependencyEdge): void;
  build(): ModuleGraph;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareEdges(left: DependencyEdge, right: DependencyEdge): number {
  const fromOrder = compareStrings(left.from, right.from);
  if (fromOrder !== 0) {
    return fromOrder;
  }

  const toOrder = compareStrings(left.to ?? "", right.to ?? "");
  if (toOrder !== 0) {
    return toOrder;
  }

  const specifierOrder = compareStrings(left.specifier, right.specifier);
  if (specifierOrder !== 0) {
    return specifierOrder;
  }

  const kindOrder = compareStrings(left.kind, right.kind);
  if (kindOrder !== 0) {
    return kindOrder;
  }

  const typeOrder = Number(left.typeOnly) - Number(right.typeOnly);
  if (typeOrder !== 0) {
    return typeOrder;
  }

  return compareStrings(left.status, right.status);
}

function edgeKey(edge: DependencyEdge): string {
  return [
    edge.from,
    edge.to ?? "",
    edge.specifier,
    edge.kind,
    String(edge.typeOnly),
    edge.status,
  ].join("\u0000");
}

export function createGraphBuilder(rootDir: string): GraphBuilder {
  const nodes = new Map<string, ModuleNode>();
  const edges = new Map<string, DependencyEdge>();

  return {
    addNode(node) {
      nodes.set(node.id, node);
    },

    addEdge(edge) {
      edges.set(edgeKey(edge), edge);
    },

    build() {
      const orderedNodes = [...nodes.entries()].sort(([left], [right]) =>
        compareStrings(left, right),
      );
      const orderedEdges = [...edges.values()].sort(compareEdges);
      return {
        rootDir,
        nodes: new Map(orderedNodes),
        edges: orderedEdges,
      };
    },
  };
}
