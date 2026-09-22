#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { analyze } from "../analyzer/analyze.js";
import { findCycles } from "../graph/cycles.js";
import { cyclicSubgraph } from "../graph/filter.js";
import { renderD2 } from "../render/d2.js";
import { renderJson } from "../render/json.js";
import { renderMermaid } from "../render/mermaid.js";
import { renderSvg } from "../render/svg.js";
import { renderCycles, renderText } from "../render/text.js";
import type { AnalyzeOptions } from "../types.js";
import { parseCliOptions } from "./options.js";

const VERSION = "0.1.0";

const HELP = `Usage: nmadge <path...> [options]

Analyze JavaScript and TypeScript module dependencies.

Output:
  --json                 Render versioned JSON
  --mermaid              Render Mermaid flowchart syntax
  --d2                   Render D2 source
  --image <file.svg>     Write a standalone SVG file
  --circular             Show cycles, or render only the cyclic subgraph

Analysis:
  --cwd <path>           Set the analysis root directory
  --tsconfig <path>      Use an explicit tsconfig.json
  --include-npm          Include source files inside node_modules
  --no-type-imports      Exclude type-only imports
  --help                 Show this help
  --version              Show the package version
`;

function printWarnings(warnings: readonly { code: string; file: string; message: string }[]): void {
  for (const warning of warnings) {
    console.error(`nmadge: ${warning.code}: ${warning.file}: ${warning.message}`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP);
    return;
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  try {
    const cliOptions = parseCliOptions(argv);
    const analysisOptions: AnalyzeOptions = {
      includeNpm: cliOptions.includeNpm,
      includeTypeImports: cliOptions.includeTypeImports,
    };
    if (cliOptions.cwd !== undefined) {
      analysisOptions.cwd = cliOptions.cwd;
    }
    if (cliOptions.tsconfig !== undefined) {
      analysisOptions.tsconfig = cliOptions.tsconfig;
    }

    const result = await analyze(cliOptions.paths, analysisOptions);
    printWarnings(result.warnings);

    if (cliOptions.circular && cliOptions.format === "text") {
      process.stdout.write(`${renderCycles(findCycles(result.graph))}\n`);
      return;
    }

    const graph = cliOptions.circular ? cyclicSubgraph(result.graph) : result.graph;
    let output: string;
    switch (cliOptions.format) {
      case "json":
        output = renderJson(graph);
        break;
      case "mermaid":
        output = renderMermaid(graph);
        break;
      case "d2":
        output = renderD2(graph);
        break;
      case "svg":
        if (cliOptions.imagePath === undefined) {
          throw new Error("An SVG output path is required");
        }
        await writeFile(cliOptions.imagePath, renderSvg(graph), "utf8");
        return;
      case "text":
        output = renderText(graph);
        break;
    }

    process.stdout.write(`${output}\n`);
  } catch (error) {
    console.error(`nmadge: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}

await main();
