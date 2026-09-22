# nmadge — Implementation Design Document

## 1. Purpose

`nmadge` is a modern JavaScript and TypeScript module dependency analyzer.

It is intended to cover the main use cases of Madge while using a modern implementation and avoiding Madge's old dependency stack.

Primary goals:

- analyze modern JavaScript and TypeScript
- detect circular dependencies
- query module dependencies
- output dependency graphs as text, JSON, Mermaid, D2, and SVG
- generate SVG without requiring Graphviz or another system package
- provide both a CLI and a JavaScript/TypeScript API
- keep parsing, resolution, graph analysis, rendering, and CLI code separate
- remain understandable and maintainable

`nmadge` does not need to preserve Madge's internal architecture.

Compatibility with every historical Madge feature is not a goal for the first release.

---

# 2. Runtime and Tooling

Use:

- TypeScript
- ESM
- Node.js 22 or newer as the supported runtime
- Bun as the development package manager and test runner
- `tsc` for building the published package

Do not make the published package depend on Bun.

The installed `nmadge` CLI must work with Node.js.

Source files must use ESM syntax.

Because the TypeScript configuration uses `NodeNext`, relative imports in source code must include the emitted `.js` extension.

Example:

```ts
import { analyze } from "../analyzer/analyze.js";
```

Do not write:

```ts
import { analyze } from "../analyzer/analyze";
```

---

# 3. Project Structure

Use this structure:

```text
.
├── .gitignore
├── bun.lock
├── package.json
├── README.md
├── src
│   ├── analyzer
│   │   ├── analyze.ts
│   │   ├── discover.ts
│   │   ├── imports.ts
│   │   └── resolver.ts
│   ├── cli
│   │   ├── main.ts
│   │   └── options.ts
│   ├── graph
│   │   ├── cycles.ts
│   │   ├── filter.ts
│   │   ├── graph.ts
│   │   └── queries.ts
│   ├── index.ts
│   ├── plugin
│   │   └── types.ts
│   ├── render
│   │   ├── d2.ts
│   │   ├── json.ts
│   │   ├── mermaid.ts
│   │   ├── svg.ts
│   │   └── text.ts
│   └── types.ts
└── tsconfig.json
```

Add a `LICENSE` file before publishing the package.

Do not create a monorepo.

Do not split the CLI and library into separate npm packages.

---

# 4. package.json

Use this initial `package.json`:

```json
{
  "name": "nmadge",
  "version": "0.1.0",
  "description": "Modern JavaScript and TypeScript module dependency graph analyzer",
  "keywords": [
    "circular-dependency",
    "dependency",
    "dependency-graph",
    "javascript",
    "madge",
    "typescript"
  ],
  "license": "MIT",
  "bin": {
    "nmadge": "./dist/cli/main.js"
  },
  "files": ["dist", "README.md", "LICENSE"],
  "type": "module",
  "sideEffects": false,
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "check": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json --noEmit",
    "lint": "oxlint src",
    "format": "oxfmt --write .",
    "format:check": "oxfmt --check .",
    "test": "bun test",
    "dev": "bun run src/cli/main.ts",
    "prepack": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@dagrejs/dagre": "^3.1.1",
    "oxc-parser": "^0.151.0",
    "oxc-resolver": "^11.24.2",
    "oxc-walker": "^1.1.1"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "oxfmt": "^0.70.0",
    "oxlint": "^1.85.0",
    "typescript": "^7.0.2"
  },
  "engines": {
    "node": ">=22.0.0"
  },
  "packageManager": "bun@1.4.2"
}
```

Do not add Commander, Chalk, Ora, Graphviz, ts-graphviz, glob libraries, or a general graph library unless a concrete requirement appears.

---

# 5. TypeScript Configuration

Use:

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "NodeNext",
    "rootDir": "src",
    "outDir": "dist",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "exactOptionalPropertyTypes": true,

    "moduleResolution": "nodenext",
    "verbatimModuleSyntax": true,
    "types": ["node"],

    // Best practices
    "strict": true,
    "skipLibCheck": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,

    // Some stricter flags (disabled by default)
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noPropertyAccessFromIndexSignature": true
  },
  "include": ["src/**/*.ts"]
}
```

Do not bundle the package.

`tsc` should preserve the source module structure in `dist/`.

Tests use `tsconfig.test.json`, which extends this configuration, adds Bun's
`bun-types`, and includes `test/**/*.ts`. The `check` script runs both the
production and test configurations.

---

# 6. Core Data Model

All shared public types belong in:

```text
src/types.ts
```

Use the following conceptual model.

```ts
export type ModuleId = string;

export type DependencyKind =
  "import" | "dynamic-import" | "require" | "require-resolve" | "re-export";

export type DependencyStatus = "internal" | "external" | "unresolved";

export interface ModuleNode {
  id: ModuleId;
  absolutePath: string;
}

export interface DependencyEdge {
  from: ModuleId;

  /**
   * Present only when status === "internal".
   */
  to?: ModuleId;

  /**
   * Original source specifier.
   *
   * Examples:
   * "./foo.js"
   * "react"
   * "@/utils"
   */
  specifier: string;

  kind: DependencyKind;

  /**
   * true for imports such as:
   *
   * import type { Foo } from "./foo.js"
   * export type { Foo } from "./foo.js"
   */
  typeOnly: boolean;

  status: DependencyStatus;
}

export interface ModuleGraph {
  /**
   * Absolute working directory used as the graph root.
   */
  rootDir: string;

  nodes: ReadonlyMap<ModuleId, ModuleNode>;

  edges: readonly DependencyEdge[];
}

export type AnalysisWarningCode =
  "parse-error" | "unresolved-import" | "dynamic-specifier" | "unsupported-file";

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
  /**
   * Base directory.
   *
   * Defaults to process.cwd().
   */
  cwd?: string;

  /**
   * Explicit tsconfig path.
   *
   * If omitted, resolver discovery is used.
   */
  tsconfig?: string;

  /**
   * Analyze files inside node_modules.
   *
   * Default: false.
   */
  includeNpm?: boolean;

  /**
   * Include type-only imports as graph edges.
   *
   * Default: true.
   */
  includeTypeImports?: boolean;

  /**
   * Source file extensions.
   *
   * Defaults to the built-in supported extensions.
   */
  extensions?: readonly string[];
}

export type AnalyzeInput = string | readonly string[];
```

Do not expose OXC AST types in the public API.

Do not expose Dagre types in the public API.

---

# 7. Module IDs

Graph module IDs must be deterministic.

A `ModuleId` is:

- relative to `AnalyzeOptions.cwd`
- normalized to POSIX `/`
- without a leading `./`

Example:

```text
src/analyzer/analyze.ts
```

Do not use absolute filesystem paths as graph IDs.

Absolute paths may exist only in `ModuleNode.absolutePath`.

For example:

```ts
{
  id: "src/analyzer/analyze.ts",
  absolutePath: "/Users/example/project/src/analyzer/analyze.ts"
}
```

This makes output stable across machines.

---

# 8. Supported Source Files

Default supported extensions:

```text
.js
.jsx
.ts
.tsx
.mjs
.cjs
.mts
.cts
```

The initial version does not parse:

```text
.vue
.svelte
.astro
```

The architecture must allow those formats to be added later without changing the graph model.

---

# 9. Analysis Pipeline

The complete analysis pipeline is:

```text
CLI/API input
    ↓
discover seed files
    ↓
read source
    ↓
extract dependency references
    ↓
resolve dependency specifiers
    ↓
follow resolved local dependencies
    ↓
construct ModuleGraph
    ↓
return AnalysisResult
```

Each source file must be parsed at most once during one `analyze()` call.

Use a queue or worklist.

Do not recursively call `analyze()`.

---

# 10. src/analyzer/discover.ts

Responsibility:

> Convert user input paths into initial source files.

This file performs filesystem discovery only.

It must not:

- parse source code
- resolve imports
- build graph edges
- detect cycles
- render output

Export:

```ts
export async function discoverFiles(
  input: AnalyzeInput,
  options: RequiredDiscoveryOptions,
): Promise<string[]>;
```

Exact internal type names may differ.

Behavior:

1. Resolve every input relative to `cwd`.
2. If an input is a file, include it if supported.
3. If an input is a directory, recursively scan it.
4. Ignore `.git`.
5. Ignore `node_modules` when `includeNpm === false`.
6. Do not follow directory symlinks.
7. Return absolute paths.
8. Remove duplicates.
9. Sort paths before returning.

Filesystem enumeration order must never affect output.

---

# 11. src/analyzer/imports.ts

Responsibility:

> Parse one JS/TS source file and extract dependency references.

Use:

```text
oxc-parser
oxc-walker
```

Do not resolve paths here.

Do not access unrelated files here.

Define an internal reference type such as:

```ts
export interface ImportReference {
  specifier: string;
  kind: DependencyKind;
  typeOnly: boolean;
}
```

Export:

```ts
export function extractImports(source: string, filePath: string): ImportExtractionResult;
```

The result should contain:

```ts
interface ImportExtractionResult {
  imports: readonly ImportReference[];
  warnings: readonly AnalysisWarning[];
}
```

Recognize at least:

```ts
import foo from "./foo.js";
import "./foo.js";

import type { Foo } from "./foo.js";

export { foo } from "./foo.js";
export type { Foo } from "./foo.js";
export * from "./foo.js";

import("./foo.js");

require("./foo.js");

require.resolve("./foo.js");
```

Only statically known string specifiers are resolvable.

Example:

```ts
import(path);
```

must not be treated as a normal resolved dependency.

It may produce:

```text
dynamic-specifier
```

warning.

Parser diagnostics that prevent useful analysis should become `parse-error` warnings.

Do not crash the entire project because one source file cannot be parsed unless the parser itself fails unexpectedly.

---

# 12. src/analyzer/resolver.ts

Responsibility:

> Resolve one import specifier from one importer.

Use:

```text
oxc-resolver
```

Do not implement Node or TypeScript package resolution manually.

Define an internal result:

```ts
export type ResolveResult =
  | {
      status: "internal";
      absolutePath: string;
    }
  | {
      status: "external";
    }
  | {
      status: "unresolved";
      reason?: string;
    };
```

Export a resolver factory:

```ts
export function createResolver(options: AnalyzeOptions): Resolver;
```

Internal interface:

```ts
export interface Resolver {
  resolve(specifier: string, importer: string): ResolveResult;
}
```

Classification rules:

### Internal

A dependency is `internal` when it resolves to a source file that should be included in the graph.

### External

A dependency is `external` when it refers to:

- a Node.js builtin
- an npm package excluded because `includeNpm === false`
- another dependency intentionally outside analysis scope

### Unresolved

A dependency is `unresolved` when resolution should have succeeded but no target can be found.

Do not create graph nodes for external or unresolved dependencies.

---

# 13. src/analyzer/analyze.ts

Responsibility:

> Orchestrate the complete analysis process.

This is the main analyzer entry point.

Export:

```ts
export async function analyze(
  input: AnalyzeInput,
  options?: AnalyzeOptions,
): Promise<AnalysisResult>;
```

Algorithm:

```text
normalize options
↓
discover seed files
↓
create resolver
↓
put seed files into queue
↓
while queue has files:
    read file
    skip if already analyzed
    parse dependencies
    add module node
    resolve each dependency
    add dependency edge
    if resolved dependency is internal and unseen:
        add it to queue
↓
finalize graph
↓
return graph + warnings
```

Important:

If input is one file:

```bash
nmadge src/main.ts
```

`nmadge` must follow its local dependencies recursively.

The graph must not be limited to the original input file.

A file must not be parsed more than once.

---

# 14. src/graph/graph.ts

Responsibility:

> Construct and normalize `ModuleGraph`.

This module contains graph construction helpers.

It must not:

- access the filesystem
- parse source code
- resolve modules
- render output

Suggested internal API:

```ts
export function createGraphBuilder(rootDir: string): GraphBuilder;
```

The builder may provide:

```ts
addNode(...)
addEdge(...)
build()
```

`build()` must return deterministic data.

Nodes should be ordered by `ModuleId`.

Edges should be sorted by:

```text
from
to
specifier
kind
```

Graph algorithms must not depend on insertion order.

---

# 15. src/graph/cycles.ts

Responsibility:

> Find circular dependencies.

Export:

```ts
export function findCycles(graph: ModuleGraph): readonly Cycle[];
```

Define:

```ts
export interface Cycle {
  modules: readonly ModuleId[];
}
```

Only internal edges participate in cycle detection.

External and unresolved edges are ignored.

A cycle result must not repeat its first module at the end.

Example:

```ts
{
  modules: ["src/a.ts", "src/b.ts", "src/c.ts"];
}
```

The text renderer may display this as:

```text
src/a.ts -> src/b.ts -> src/c.ts -> src/a.ts
```

Cycle results must be deterministic.

Equivalent cycles discovered from different starting points must not appear multiple times.

Self-imports count as cycles.

Example:

```ts
import "./a.js";
```

inside `a.ts` may produce:

```text
src/a.ts -> src/a.ts
```

Use a standard DFS-based algorithm.

Do not add a graph library for this.

---

# 16. src/graph/queries.ts

Responsibility:

> Provide common read-only graph queries.

Export:

```ts
export function findDirectDependencies(graph: ModuleGraph, module: ModuleId): readonly ModuleId[];

export function findDirectDependents(graph: ModuleGraph, module: ModuleId): readonly ModuleId[];

export function findLeaves(graph: ModuleGraph): readonly ModuleId[];

export function findOrphans(graph: ModuleGraph): readonly ModuleId[];
```

Definitions:

### Direct dependencies

Modules directly imported by the requested module.

### Direct dependents

Modules that directly import the requested module.

### Leaves

Modules with no internal outgoing dependency edges.

### Orphans

Modules with no internal incoming dependency edges.

All returned arrays must be sorted.

Do not silently implement transitive dependency lookup under these names.

---

# 17. src/graph/filter.ts

Responsibility:

> Produce derived graphs without mutating the original graph.

Export:

```ts
export function filterGraph(graph: ModuleGraph, predicate: GraphFilter): ModuleGraph;

export function cyclicSubgraph(graph: ModuleGraph): ModuleGraph;
```

`cyclicSubgraph()` keeps only modules participating in at least one circular dependency and the internal edges between them.

Do not mutate the original graph.

---

# 18. src/plugin/types.ts

This file defines internal extension interfaces.

It is not a public plugin SDK in version `0.1.0`.

Define:

```ts
export interface SourceExtractor {
  supports(filePath: string): boolean;

  extract(source: string, filePath: string): ImportExtractionResult;
}
```

The built-in JS/TS analyzer should satisfy this interface.

The purpose is to make future support possible for:

```text
Vue
Svelte
Astro
```

Do not implement:

- plugin discovery
- npm plugin loading
- hooks
- plugin configuration
- lifecycle events
- plugin registries

An ordinary array of extractors is enough.

---

# 19. Rendering Rules

All renderers consume `ModuleGraph`.

Renderers must never:

- read source files
- resolve imports
- modify the graph
- detect dependencies

Rendering is a one-way operation:

```text
ModuleGraph
    ↓
representation
```

Output must be deterministic.

---

# 20. src/render/json.ts

Responsibility:

> Produce stable machine-readable JSON.

Do not serialize `Map` directly.

Define an explicit versioned JSON format.

Example:

```json
{
  "version": 1,
  "root": "/project",
  "modules": [
    {
      "id": "src/a.ts"
    },
    {
      "id": "src/b.ts"
    }
  ],
  "dependencies": [
    {
      "from": "src/a.ts",
      "to": "src/b.ts",
      "specifier": "./b.js",
      "kind": "import",
      "typeOnly": false,
      "status": "internal"
    }
  ]
}
```

Export:

```ts
export function renderJson(graph: ModuleGraph): string;
```

JSON output must end with a newline only when the CLI writes it.

The renderer itself should return JSON text without assuming stdout behavior.

---

# 21. src/render/text.ts

Responsibility:

> Produce human-readable terminal text.

Export:

```ts
export function renderText(graph: ModuleGraph): string;

export function renderCycles(cycles: readonly Cycle[]): string;
```

Default graph output should be simple.

Example:

```text
src/a.ts
  -> src/b.ts

src/b.ts
  -> src/c.ts

src/c.ts
```

Cycle output:

```text
src/a.ts -> src/b.ts -> src/c.ts -> src/a.ts
```

If no cycles exist:

```text
No circular dependencies found.
```

Do not add terminal colors in version `0.1.0`.

Plain text is sufficient.

---

# 22. src/render/mermaid.ts

Responsibility:

> Convert `ModuleGraph` to Mermaid flowchart syntax.

Export:

```ts
export function renderMermaid(graph: ModuleGraph): string;
```

Use:

```text
flowchart LR
```

Do not use file paths directly as Mermaid node identifiers.

Generate deterministic synthetic IDs:

```text
n0
n1
n2
```

Use the path as the visible label.

Example:

```text
flowchart LR
  n0["src/a.ts"]
  n1["src/b.ts"]
  n0 --> n1
```

Escape labels correctly.

Only internal dependencies should become normal graph edges.

---

# 23. src/render/d2.ts

Responsibility:

> Convert `ModuleGraph` to D2 source text.

Export:

```ts
export function renderD2(graph: ModuleGraph): string;
```

As with Mermaid, use stable generated identifiers instead of raw file paths as structural identifiers.

Example:

```text
n0: "src/a.ts"
n1: "src/b.ts"

n0 -> n1
```

Do not add a D2 runtime dependency.

`nmadge` produces D2 source.

Rendering D2 source into an image is outside this module.

---

# 24. src/render/svg.ts

Responsibility:

> Render a graph directly to standalone SVG.

Use:

```text
@dagrejs/dagre
```

Do not use:

- Graphviz
- system commands
- child_process
- ts-graphviz
- browser DOM APIs
- Canvas
- Puppeteer
- Mermaid CLI

Dagre is used only for graph layout.

`nmadge` creates the SVG XML itself.

Export:

```ts
export interface SvgRenderOptions {
  direction?: "LR" | "TB";
}

export function renderSvg(graph: ModuleGraph, options?: SvgRenderOptions): string;
```

Default direction:

```text
LR
```

Rendering pipeline:

```text
ModuleGraph
    ↓
Dagre graph
    ↓
Dagre computes coordinates
    ↓
nmadge generates SVG elements
    ↓
SVG string
```

Use simple visual primitives:

```text
<svg>
<defs>
<marker>
<path>
<rect>
<text>
```

Each module should be shown as a rectangular node.

Each internal dependency should be shown as an arrow.

No CSS framework is required.

Do not attempt sophisticated theme support in `0.1.0`.

The SVG must contain everything required to display itself.

Do not depend on external fonts or stylesheets.

Escape all XML text.

Node dimensions may be estimated from label length.

A simple rule is sufficient:

```ts
width = clamp(120, label.length * 8 + 24, 420);
height = 36;
```

Pixel-perfect text measurement is not required.

---

# 25. Why SVG Uses Dagre

SVG generation exists to avoid the operational cost of Madge's Graphviz dependency.

Therefore the initial implementation should not reintroduce Graphviz through WASM.

Use:

```text
@dagrejs/dagre
```

for layout and generate SVG directly.

This gives the package:

- no system Graphviz installation
- no subprocess execution
- no large Graphviz WASM runtime
- a small and explicit SVG rendering implementation
- full control over the resulting SVG

Dagre is a layout engine, not the dependency graph data model.

Do not use Dagre objects outside `render/svg.ts`.

---

# 26. src/cli/options.ts

Responsibility:

> Parse and validate CLI arguments.

Use:

```ts
import { parseArgs } from "node:util";
```

Do not add Commander.

Export:

```ts
export interface CliOptions {
  paths: string[];

  format: "text" | "json" | "mermaid" | "d2" | "svg";

  imagePath?: string;

  circular: boolean;

  cwd?: string;
  tsconfig?: string;

  includeNpm: boolean;
  includeTypeImports: boolean;
}

export function parseCliOptions(argv: readonly string[]): CliOptions;
```

Supported syntax:

```bash
nmadge <path...>
```

Examples:

```bash
nmadge src

nmadge src --circular

nmadge src --json

nmadge src --mermaid

nmadge src --d2

nmadge src --image graph.svg
```

Additional options:

```bash
--cwd <path>
--tsconfig <path>
--include-npm
--no-type-imports
--circular
--json
--mermaid
--d2
--image <file>
--help
--version
```

These output modes are mutually exclusive:

```text
--json
--mermaid
--d2
--image
```

No explicit output mode means text.

`--image` only supports `.svg` in version `0.1.0`.

Reject other extensions with a clear error.

---

# 27. Meaning of --circular

`--circular` has two behaviors.

When used alone:

```bash
nmadge src --circular
```

print the discovered cycles using `renderCycles()`.

When combined with a structured or graphical output mode:

```bash
nmadge src --circular --json
nmadge src --circular --mermaid
nmadge src --circular --d2
nmadge src --circular --image cycles.svg
```

first create:

```ts
cyclicSubgraph(graph);
```

and render that graph.

This behavior must be documented.

---

# 28. src/cli/main.ts

Responsibility:

> Connect CLI input, public analysis functions, graph functions, and renderers.

This file must contain the executable shebang:

```ts
#!/usr/bin/env node
```

It should:

```text
parse arguments
↓
handle --help / --version
↓
call analyze()
↓
optionally select cyclic graph
↓
call renderer
↓
write stdout or file
↓
write warnings to stderr
```

Do not put:

- parser logic
- resolver logic
- graph algorithms
- SVG layout logic

inside `main.ts`.

Use `node:fs/promises` to write image files.

Exit codes:

```text
0 = successful execution
1 = fatal analysis or CLI error
```

Finding a circular dependency is not itself an execution failure.

A future explicit option such as `--fail-on-circular` may change this behavior.

Do not add it in version `0.1.0`.

---

# 29. src/index.ts

This file defines the complete public package API.

Anything not exported here is private implementation detail.

Export exactly these runtime functions:

```ts
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
```

Export these public types:

```ts
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
```

Do not export:

- OXC parser objects
- OXC resolver objects
- Dagre objects
- graph builder internals
- CLI implementation
- plugin internals
- filesystem discovery helpers

---

# 30. Public API Example

Users should be able to write:

```ts
import { analyze, findCycles, renderSvg } from "nmadge";

const { graph, warnings } = await analyze("./src");

const cycles = findCycles(graph);

console.log(cycles);

const svg = renderSvg(graph);
```

Another example:

```ts
import { analyze, findDirectDependents } from "nmadge";

const { graph } = await analyze("./src");

const dependents = findDirectDependents(graph, "src/utils.ts");
```

No class instance is required.

Prefer plain functions.

---

# 31. External Dependencies

Runtime dependencies have clear responsibilities.

## oxc-parser

Used only for parsing JavaScript and TypeScript.

## oxc-walker

Used only for traversing OXC ASTs.

## oxc-resolver

Used only for module resolution.

## @dagrejs/dagre

Used only inside SVG rendering for graph layout.

No dependency should become the application's internal data model.

---

# 32. Error Handling

Fatal errors include:

- input path does not exist
- no supported input files can be found
- required file cannot be read
- invalid CLI option
- invalid SVG output extension
- unexpected internal parser/resolver failure

Recoverable analysis problems should become warnings where possible.

Examples:

```text
parse-error
unresolved-import
dynamic-specifier
unsupported-file
```

Warnings are returned through:

```ts
AnalysisResult.warnings;
```

The CLI prints warnings to stderr.

JSON graph output must not be polluted with warnings printed to stdout.

---

# 33. Deterministic Output

The same project state must produce the same output.

Therefore:

- discovered files are sorted
- graph nodes are sorted
- graph edges are sorted
- query results are sorted
- cycle output is canonicalized
- Mermaid node IDs are assigned from sorted nodes
- D2 node IDs are assigned from sorted nodes
- SVG node IDs are assigned from sorted nodes

Never depend on filesystem traversal order.

This is important for:

- tests
- Git diffs
- CI
- reproducible output

---

# 34. Initial Non-Goals

Do not implement these in version `0.1.0`:

- AMD
- RequireJS configuration
- webpack configuration parsing
- CSS dependency analysis
- Sass
- Less
- Stylus
- Vue
- Svelte
- Astro
- PNG generation
- PDF generation
- Graphviz compatibility
- Madge configuration file compatibility
- `.madgerc`
- complex theme configuration
- plugin package discovery
- watch mode
- interactive UI

These may be considered later.

Do not add abstractions now solely because one of these features might exist later.

---

# 35. Implementation Order

Implement in this exact order.

## Step 1 — Core types

Implement:

```text
src/types.ts
src/plugin/types.ts
```

No filesystem work yet.

## Step 2 — Discovery

Implement:

```text
src/analyzer/discover.ts
```

Verify directories and files are discovered deterministically.

## Step 3 — Import extraction

Implement:

```text
src/analyzer/imports.ts
```

Test JS, TS, dynamic import, require, re-export, and type imports.

## Step 4 — Resolution

Implement:

```text
src/analyzer/resolver.ts
```

Verify:

```text
relative imports
package exports
tsconfig paths
Node builtins
node_modules exclusion
```

## Step 5 — Graph construction

Implement:

```text
src/graph/graph.ts
src/analyzer/analyze.ts
```

At this point this must work:

```bash
nmadge src --json
```

even if the final CLI is still incomplete.

## Step 6 — Queries

Implement:

```text
src/graph/queries.ts
src/graph/cycles.ts
src/graph/filter.ts
```

## Step 7 — Basic renderers

Implement:

```text
src/render/text.ts
src/render/json.ts
```

## Step 8 — CLI

Implement:

```text
src/cli/options.ts
src/cli/main.ts
```

## Step 9 — Portable graph formats

Implement:

```text
src/render/mermaid.ts
src/render/d2.ts
```

## Step 10 — SVG

Implement:

```text
src/render/svg.ts
```

Use Dagre only at this stage.

---

# 36. Minimum Acceptance Test

Given:

```text
fixture/
├── a.ts
├── b.ts
└── c.ts
```

with:

```ts
// a.ts
import "./b.js";
```

```ts
// b.ts
import "./c.js";
```

```ts
// c.ts
import "./a.js";
```

this command:

```bash
nmadge fixture --circular
```

must report one circular dependency containing:

```text
a.ts
b.ts
c.ts
```

This must also work:

```bash
nmadge fixture --json
```

This must produce valid Mermaid:

```bash
nmadge fixture --mermaid
```

This must produce valid D2:

```bash
nmadge fixture --d2
```

This must create a standalone SVG without Graphviz installed:

```bash
nmadge fixture --image graph.svg
```

---

# 37. Architectural Rule

The most important rule in the project is:

```text
filesystem/source code
        ↓
     analyzer
        ↓
    ModuleGraph
        ↓
 ┌──────┼─────────┐
 │      │         │
graph  render   public API
 │      │
 └──┬───┘
    ↓
   CLI
```

`ModuleGraph` is the boundary between source analysis and every later operation.

The analyzer must not know how graphs are rendered.

Renderers must not know how source code is parsed.

Graph algorithms must not access the filesystem.

The CLI must coordinate existing modules instead of implementing their behavior.

If a proposed change breaks these boundaries, prefer changing the proposal rather than weakening the boundaries.

---

# 38. First Release Principle

Do not optimize for the smallest possible source code.

Do not optimize for zero dependencies.

Do not reproduce Madge only for compatibility.

Prefer:

- current maintained dependencies
- explicit responsibilities
- deterministic behavior
- standard TypeScript APIs
- simple public functions
- easy debugging
- easy removal or replacement of dependencies

The first target is a reliable modern dependency analyzer, not a framework for every possible dependency-analysis feature.
