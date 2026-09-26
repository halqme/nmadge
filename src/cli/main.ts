#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { analyze } from "../analyzer/analyze.ts";
import { findCycles } from "../graph/cycles.ts";
import { cyclicSubgraph } from "../graph/filter.ts";
import { findDirectDependents, findLeaves, findOrphans } from "../graph/queries.ts";
import { renderD2 } from "../render/d2.ts";
import { renderJson } from "../render/json.ts";
import { renderMermaid } from "../render/mermaid.ts";
import { renderCycles, renderText } from "../render/text.ts";
import type { AnalyzeOptions, ModuleGraph, ModuleId } from "../types.ts";
import { CliUsageError, parseCliOptions } from "./options.ts";

function printWarnings(warnings: readonly { code: string; file: string; message: string }[]): void {
  for (const warning of warnings) {
    console.error(`oxdg: ${warning.code}: ${warning.file}: ${warning.message}`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function setExitCode(failOnCircular: boolean, cycleCount: number): void {
  process.exitCode = failOnCircular && cycleCount > 0 ? 1 : 0;
}

function renderModuleList(modules: readonly string[], json: boolean): string {
  if (json) {
    return `${JSON.stringify(modules, null, 2)}\n`;
  }
  return modules.length === 0 ? "" : `${modules.join("\n")}\n`;
}

function resolveDependsModule(graph: ModuleGraph, requested: string): ModuleId {
  const normalized = requested.replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (graph.nodes.has(normalized)) {
    return normalized;
  }

  const absolutePath = resolve(graph.rootDir, requested);
  const absoluteMatches = [...graph.nodes.values()].filter(
    (node) => node.absolutePath === absolutePath,
  );
  if (absoluteMatches.length === 1) {
    return absoluteMatches[0]?.id ?? normalized;
  }

  const suffixMatches = [...graph.nodes.keys()].filter(
    (module) => module === normalized || module.endsWith(`/${normalized}`),
  );
  if (suffixMatches.length === 1) {
    return suffixMatches[0] ?? normalized;
  }
  if (suffixMatches.length > 1 || absoluteMatches.length > 1) {
    throw new CliUsageError(`--depends module is ambiguous: ${requested}`);
  }
  throw new CliUsageError(`--depends module was not found: ${requested}`);
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  try {
    const cliOptions = parseCliOptions(argv);
    if (cliOptions.help || cliOptions.version) {
      process.exitCode = 0;
      return;
    }

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
    if (cliOptions.extensions !== undefined) {
      analysisOptions.extensions = cliOptions.extensions;
    }
    if (cliOptions.exclude !== undefined) {
      analysisOptions.exclude = cliOptions.exclude;
    }

    const result = await analyze(cliOptions.paths, analysisOptions);
    printWarnings(result.warnings);
    const cycles = cliOptions.circular || cliOptions.failOnCircular ? findCycles(result.graph) : [];

    if (cliOptions.orphans || cliOptions.leaves || cliOptions.depends !== undefined) {
      const dependsModule =
        cliOptions.depends === undefined
          ? undefined
          : resolveDependsModule(result.graph, cliOptions.depends);
      const modules = cliOptions.orphans
        ? findOrphans(result.graph)
        : cliOptions.leaves
          ? findLeaves(result.graph)
          : findDirectDependents(result.graph, dependsModule ?? "");
      process.stdout.write(renderModuleList(modules, cliOptions.format === "json"));
      setExitCode(cliOptions.failOnCircular, cycles.length);
      return;
    }

    if (cliOptions.circular && cliOptions.format === "text") {
      process.stdout.write(`${renderCycles(cycles)}\n`);
      setExitCode(cliOptions.failOnCircular, cycles.length);
      return;
    }

    const graph = cliOptions.circular ? cyclicSubgraph(result.graph) : result.graph;
    let output: string;
    switch (cliOptions.format) {
      case "json":
        output = renderJson(graph);
        break;
      case "mermaid":
        output = renderMermaid(
          graph,
          cliOptions.rankdir === undefined ? {} : { direction: cliOptions.rankdir },
        );
        break;
      case "d2":
        output = renderD2(graph);
        break;
      case "svg": {
        if (cliOptions.imagePath === undefined) {
          throw new Error("An SVG output path is required");
        }
        const { renderSvg } = await import("../render/svg.ts");
        await writeFile(
          cliOptions.imagePath,
          renderSvg(
            graph,
            cliOptions.rankdir === undefined ? {} : { direction: cliOptions.rankdir },
          ),
          "utf8",
        );
        setExitCode(cliOptions.failOnCircular, cycles.length);
        return;
      }
      case "text":
        output = renderText(graph);
        break;
    }

    process.stdout.write(`${output}\n`);
    setExitCode(cliOptions.failOnCircular, cycles.length);
  } catch (error) {
    if (error instanceof CliUsageError) {
      if (!error.reported) {
        console.error(`oxdg: ${errorMessage(error)}`);
      }
      process.exitCode = 2;
      return;
    }
    console.error(`oxdg: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}

await main();
