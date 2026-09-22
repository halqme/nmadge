# nmadge

Modern JavaScript and TypeScript module dependency graph analyzer.

## Requirements

- Node.js 22 or newer to run the published CLI
- Bun for development and tests

Install dependencies with:

```bash
bun install
```

## CLI

```bash
nmadge src
nmadge src --circular
nmadge src --json
nmadge src --mermaid
nmadge src --d2
nmadge src --image graph.svg
```

Without an output option, `nmadge` prints a plain-text dependency graph. `--circular` prints cycles when used alone. When `--circular` is combined with `--json`, `--mermaid`, `--d2`, or `--image`, it renders only the cyclic subgraph.

Additional analysis options are `--cwd`, `--tsconfig`, `--include-npm`, and `--no-type-imports`. Analysis warnings are written to stderr; structured output remains on stdout.

SVG output is generated directly with Dagre and does not require Graphviz or another system package.

## API

```ts
import { analyze, findCycles, renderSvg } from "nmadge";

const { graph, warnings } = await analyze("./src");
const cycles = findCycles(graph);
const svg = renderSvg(graph);
```

The public API exposes analysis, graph queries and filters, text/JSON/Mermaid/D2/SVG renderers, and their shared types. Module IDs are stable paths relative to the analysis root.

## Development

```bash
bun run check
bun run lint
bun run format:check
bun run build
bun test
```
