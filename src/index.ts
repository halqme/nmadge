export { analyze } from "./analyzer/analyze.js";

export { findCycles } from "./graph/cycles.js";

export {
  findDirectDependencies,
  findDirectDependents,
  findLeaves,
  findOrphans,
} from "./graph/queries.js";

export { filterGraph, cyclicSubgraph } from "./graph/filter.js";

export { renderText } from "./render/text.js";
export { renderJson } from "./render/json.js";
export { renderMermaid } from "./render/mermaid.js";
export { renderD2 } from "./render/d2.js";
export { renderSvg } from "./render/svg.js";

export type {
  AnalyzeInput,
  AnalyzeOptions,
  AnalysisResult,
  AnalysisWarning,
  AnalysisWarningCode,
  DependencyEdge,
  DependencyKind,
  DependencyStatus,
  ModuleGraph,
  ModuleId,
  ModuleNode,
} from "./types.js";

export type { Cycle } from "./graph/cycles.js";
export type { SvgRenderOptions } from "./render/svg.js";
