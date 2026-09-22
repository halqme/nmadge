import type { DependencyEdge, ModuleGraph } from "../types.ts";

interface JsonModule {
  id: string;
}

interface JsonDependency {
  from: string;
  to?: string;
  specifier: string;
  kind: DependencyEdge["kind"];
  typeOnly: boolean;
  status: DependencyEdge["status"];
}

function serializeDependency(edge: DependencyEdge): JsonDependency {
  if (edge.to === undefined) {
    return {
      from: edge.from,
      specifier: edge.specifier,
      kind: edge.kind,
      typeOnly: edge.typeOnly,
      status: edge.status,
    };
  }

  return {
    from: edge.from,
    to: edge.to,
    specifier: edge.specifier,
    kind: edge.kind,
    typeOnly: edge.typeOnly,
    status: edge.status,
  };
}

export function renderJson(graph: ModuleGraph): string {
  const modules = [...graph.nodes.values()].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
  const output = {
    version: 1,
    root: graph.rootDir,
    modules: modules.map<JsonModule>((node) => ({ id: node.id })),
    dependencies: graph.edges.map(serializeDependency),
  };
  return JSON.stringify(output, null, 2);
}
