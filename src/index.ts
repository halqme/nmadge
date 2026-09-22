export { analyze } from "./analyzer/analyze.ts";

export { findCycles } from "./graph/cycles.ts";

export {
  findDirectDependencies,
  findDirectDependents,
  findLeaves,
  findOrphans,
} from "./graph/queries.ts";

export { filterGraph, cyclicSubgraph } from "./graph/filter.ts";

export { renderText } from "./render/text.ts";
export { renderJson } from "./render/json.ts";
export { renderMermaid } from "./render/mermaid.ts";
export { renderD2 } from "./render/d2.ts";
export { renderSvg } from "./render/svg.ts";

export type {
  AnalyzeInput,
  AnalyzeOptions,
  AnalysisResult,
  AnalysisWarning,
  AnalysisWarningCode,
  DependencyEdge,
  DependencyKind,
  DependencyStatus,
  ExcludePattern,
  GraphDirection,
  ModuleGraph,
  ModuleId,
  ModuleNode,
} from "./types.ts";

export type { Cycle } from "./graph/cycles.ts";
export type { MermaidRenderOptions } from "./render/mermaid.ts";
export type { SvgRenderOptions } from "./render/svg.ts";
