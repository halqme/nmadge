# oxdg

[![npm version](https://img.shields.io/npm/v/oxdg)](https://www.npmjs.com/package/oxdg)
[![CI](https://github.com/halqme/oxdg/actions/workflows/ci.yml/badge.svg)](https://github.com/halqme/oxdg/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/oxdg)](LICENSE)

A fast, lightweight dependency graph CLI for modern JavaScript and TypeScript, built on [Oxc](https://oxc.rs/).

**oxdg = Oxc Dependency Graph**

oxdg uses `oxc-parser` and `oxc-resolver` for parsing and module resolution, then adds a small graph layer for dependency analysis, queries, and rendering.

No initialization. No required config file. No system Graphviz dependency.

Try it:

```bash
npx oxdg src
npx oxdg src --circular
npx oxdg src --image graph.svg
```

![npx oxdg src/index.ts --image graph.svg](https://raw.githubusercontent.com/halqme/oxdg/refs/heads/main/graph.svg)

## Features

- JavaScript and TypeScript
- Vue single-file components, extracting imports from `<script>` and `<script setup>` blocks written in JS, TS, JSX, or TSX
- ESM and CommonJS
- Static imports, dynamic imports, `require()`, `require.resolve()`, and re-exports
- Type-only imports and TypeScript path aliases
- Circular dependency detection with CI-friendly failure codes
- Orphan, leaf, and direct-dependent queries
- Text, JSON, Mermaid, D2, and standalone SVG output
- Zero-config one-shot CLI
- No Graphviz or other system package required for SVG generation

## Performance

The stable benchmark measures the latest published npm release of oxdg against pinned versions of other dependency-graph tools on fixed [Hono](https://github.com/honojs/hono) and [Webpack](https://github.com/webpack/webpack) revisions.

The full report records runtime statistics, release-to-main changes, exact commands, package footprint, dependency locks, and runner metadata.

[View the released and development benchmark report →](https://halqme.github.io/oxdg/#released)

## Package footprint

Package footprint is measured separately from runtime performance on every CI pull request and release validation. The shared check reports packed and unpacked package sizes plus `node_modules` size after a clean install in the GitHub Actions Summary. It also enforces the existing **500 KiB unpacked-package limit**.

## How it compares

oxdg is inspired by [Madge](https://github.com/pahen/madge), but is built around the modern Oxc parser and resolver and includes Mermaid, D2, and standalone SVG output.

The table below focuses on documented capabilities rather than overall ratings. It was checked against the linked public documentation on 2026-09-22.

| Capability                             | [Madge](https://github.com/pahen/madge) | [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) | [dpdm](https://github.com/acrazing/dpdm) | [module-graph](https://github.com/thepassle/module-graph) | oxdg       |
| -------------------------------------- | --------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------- | ---------- |
| JavaScript / TypeScript                | Yes                                     | Yes                                                                  | Yes                                      | Yes                                                       | Yes        |
| ESM                                    | Yes                                     | Yes                                                                  | Yes                                      | Yes                                                       | Yes        |
| CommonJS `require()`                   | Yes                                     | Yes                                                                  | Yes                                      | No                                                        | Yes        |
| Circular dependency detection          | Yes                                     | Yes                                                                  | Yes                                      | Not a primary focus                                       | Yes        |
| JSON output                            | Yes                                     | Yes                                                                  | Yes                                      | API-oriented                                              | Yes        |
| Mermaid output                         | No                                      | Yes                                                                  | No                                       | No                                                        | Yes        |
| D2 output                              | No                                      | Yes                                                                  | No                                       | No                                                        | Yes        |
| SVG output                             | Graphviz                                | Graphviz                                                             | No                                       | No                                                        | Standalone |
| System Graphviz required for SVG       | Yes                                     | Yes                                                                  | —                                        | —                                                         | No         |
| Basic CLI works without project config | Yes                                     | `--no-config` required                                               | Yes                                      | Yes                                                       | Yes        |

`dependency-cruiser` provides a substantially broader architecture-validation and rule system than oxdg. oxdg instead focuses on dependency graph analysis as a small, one-shot CLI.

`module-graph` refers to `@thepassle/module-graph`; its documented analyzer is ESM-oriented and does not analyze `require()`.

## One-shot CLI

Analyze a file or directory:

```bash
bunx oxdg ./src
```

Generate a standalone SVG:

```bash
bunx oxdg ./src/index.ts --image graph.svg
```

The resulting SVG is ready to open in a browser or share directly. No Graphviz installation is required.

Find circular dependencies:

```bash
bunx oxdg ./src --circular
bunx oxdg ./src --fail-on-circular
```

`--fail-on-circular` exits with code 1 when a cycle exists. Successful analysis exits with 0; invalid command usage exits with 2.

Example:

```text
src/a.ts -> src/b.ts -> src/a.ts
```

Query the graph:

```bash
bunx oxdg ./src --orphans
bunx oxdg ./src --leaves
bunx oxdg ./src --depends src/core.ts
bunx oxdg ./src --json --orphans
```

Adding `--json` to a query prints the matching module IDs as a JSON array.

Use structured or graph-oriented output:

```bash
bunx oxdg ./src --json
bunx oxdg ./src --mermaid --rankdir TB
bunx oxdg ./src --d2
bunx oxdg ./src --image graph.svg --rankdir TB
```

The same commands work with `npx`:

```bash
npx oxdg ./src
npx oxdg ./src/index.ts --image graph.svg
```

Without an output option, oxdg prints a plain-text dependency graph.

Additional analysis options include `--cwd`, `--tsconfig` (or `--ts-config`), `--include-npm`, `--no-type-imports`, `--extensions ts,tsx`, and repeated `--exclude` patterns.

Exclude strings use gitignore semantics via the `ignore` package, relative to `cwd` (the current directory by default), for both input files and imported modules. For example, `*.test.ts` matches at any depth, `/generated.ts` matches only at the root, `src/generated.ts` matches that path from the root, and `generated/` excludes directories of that name and their contents. Patterns are evaluated in order; `!` re-includes matching paths, but a file cannot be re-included while its parent directory is excluded. Comments (`#`) and backslash escapes follow gitignore syntax. `.gitignore` files are not loaded automatically, and gitignore patterns do not apply to modules outside `cwd`.

```bash
oxdg ./src --exclude '*.test.ts' --exclude '!src/keep.test.ts'
oxdg ./src --exclude 'generated/' --exclude '/src/legacy.ts'
```

Short aliases include `-c`, `-j`, `-i`, and `-d`. `--rankdir` accepts `LR`, `RL`, `TB`, or `BT` for Mermaid and SVG output and is rejected for other output modes.

Warnings are written to stderr, so structured output on stdout remains usable by scripts and coding agents.

## Design

oxdg deliberately leaves parsing and module resolution to Oxc.

```text
source files
    ↓
oxc-parser
    ↓
dependency extraction
    ↓
oxc-resolver
    ↓
ModuleGraph
    ├── queries
    ├── cycle detection
    ├── text
    ├── JSON
    ├── Mermaid
    ├── D2
    └── SVG
```

This keeps oxdg focused on the dependency-graph layer rather than maintaining its own JavaScript parser or module resolver.

## Installation

For repeated use in a project:

```bash
npm install --save-dev oxdg
```

or:

```bash
bun add --dev oxdg
```

The published CLI requires Node.js 22 or newer.

## API

The public API is a small functional layer over the same `ModuleGraph` used by the CLI:

```ts
import { analyze, findCycles, renderSvg } from "oxdg";

const { graph, warnings } = await analyze("./src");

const cycles = findCycles(graph);
const svg = renderSvg(graph);
```

The API also exposes graph queries and text, JSON, Mermaid, and D2 renderers.

Module IDs are normalized paths relative to the analysis root.

## Development

```bash
bun install
bun run check
bun run lint
bun run format:check
bun test
bun run build
bun run release:check
```

`check` runs TypeScript type checking.

`build` uses `tsdown` to produce the ESM distribution, declarations, and source maps.

`release:check` packs the package, validates the published contents, installs the packed artifact into a temporary project, and exercises the packaged CLI including version, circular dependency, JSON, and SVG checks.
