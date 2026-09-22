export type ModuleId = string;

export type ExcludePattern = string | RegExp;

export type GraphDirection = "LR" | "RL" | "TB" | "BT";

export type DependencyKind =
  | "import"
  | "dynamic-import"
  | "require"
  | "require-resolve"
  | "re-export";

export type DependencyStatus = "internal" | "external" | "unresolved";

export interface ModuleNode {
  id: ModuleId;
  absolutePath: string;
}

export interface DependencyEdge {
  from: ModuleId;

  /** Present only when status === "internal". */
  to?: ModuleId;

  /** Original source specifier. */
  specifier: string;

  kind: DependencyKind;
  typeOnly: boolean;
  status: DependencyStatus;
}

export interface ModuleGraph {
  /** Absolute working directory used as the graph root. */
  rootDir: string;

  nodes: ReadonlyMap<ModuleId, ModuleNode>;
  edges: readonly DependencyEdge[];
}

export type AnalysisWarningCode =
  | "parse-error"
  | "unresolved-import"
  | "dynamic-specifier"
  | "unsupported-file";

export interface AnalysisWarning {
  code: AnalysisWarningCode;
  file: string;
  message: string;
}

export interface AnalysisResult {
  graph: ModuleGraph;
  warnings: readonly AnalysisWarning[];
}

export interface AnalyzeOptions {
  /** Base directory. Defaults to process.cwd(). */
  cwd?: string;

  /** Explicit tsconfig path. */
  tsconfig?: string;

  /** Analyze files inside node_modules. Default: false. */
  includeNpm?: boolean;

  /** Include type-only imports as graph edges. Default: true. */
  includeTypeImports?: boolean;

  /** Source file extensions. */
  extensions?: readonly string[];

  /** Glob or regular-expression pattern(s) for excluded modules. */
  exclude?: ExcludePattern | readonly ExcludePattern[];
}

export type AnalyzeInput = string | readonly string[];
