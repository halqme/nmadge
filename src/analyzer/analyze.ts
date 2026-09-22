import { readFile, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { discoverFiles, DEFAULT_EXTENSIONS } from "./discover.ts";
import { extractImports } from "./imports.ts";
import type { ImportReference } from "./imports.ts";
import { createResolver } from "./resolver.ts";
import { createExcludeMatcher } from "./exclude.ts";
import { createGraphBuilder } from "../graph/graph.ts";
import type {
  AnalysisResult,
  AnalysisWarning,
  AnalyzeInput,
  AnalyzeOptions,
  DependencyEdge,
} from "../types.ts";

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeExtensions(extensions: readonly string[]): string[] {
  return [
    ...new Set(
      extensions.map((extension) =>
        extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`,
      ),
    ),
  ];
}

function moduleId(canonicalRoot: string, filePath: string): string {
  const relativePath = relative(canonicalRoot, filePath).split(sep).join("/");
  return relativePath.startsWith("./") ? relativePath.slice(2) : relativePath;
}

async function canonicalPath(filePath: string): Promise<string> {
  try {
    return await realpath(filePath);
  } catch {
    return filePath;
  }
}

function warningForUnresolved(
  filePath: string,
  reference: ImportReference,
  reason: string | undefined,
): AnalysisWarning {
  const unsupported = reason?.startsWith("resolved file has an unsupported extension") ?? false;
  return {
    code: unsupported ? "unsupported-file" : "unresolved-import",
    file: filePath,
    message: [`Unable to resolve ${JSON.stringify(reference.specifier)} from ${filePath}`, reason]
      .filter((part): part is string => Boolean(part))
      .join(": "),
  };
}

function sortWarnings(warnings: AnalysisWarning[]): void {
  warnings.sort((left, right) => {
    const fileOrder = compareStrings(left.file, right.file);
    if (fileOrder !== 0) {
      return fileOrder;
    }
    const codeOrder = compareStrings(left.code, right.code);
    return codeOrder !== 0 ? codeOrder : compareStrings(left.message, right.message);
  });
}

export async function analyze(
  input: AnalyzeInput,
  options: AnalyzeOptions = {},
): Promise<AnalysisResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  let canonicalRoot = cwd;
  try {
    canonicalRoot = await realpath(cwd);
  } catch {
    // The discovery step reports a more useful input error when the root is absent.
  }
  const extensions = normalizeExtensions(options.extensions ?? DEFAULT_EXTENSIONS);
  const includeNpm = options.includeNpm ?? false;
  const includeTypeImports = options.includeTypeImports ?? true;
  const excludeMatcher = createExcludeMatcher(options.exclude);
  const isExcluded = (filePath: string): boolean =>
    excludeMatcher(filePath) ||
    excludeMatcher(relative(canonicalRoot, filePath).split(sep).join("/"));
  const files = await discoverFiles(input, {
    cwd,
    includeNpm,
    extensions,
    exclude: isExcluded,
  });

  if (files.length === 0) {
    throw new Error("No supported source files were found in the input");
  }

  const resolverOptions: AnalyzeOptions = {
    cwd,
    includeNpm,
    extensions,
  };
  if (options.tsconfig !== undefined) {
    resolverOptions.tsconfig = options.tsconfig;
  }

  const resolver = createResolver(resolverOptions);
  const builder = createGraphBuilder(cwd);
  const warnings: AnalysisWarning[] = [];
  const queue = [...files];
  const pending = new Set(files);
  const analyzed = new Set<string>();

  while (queue.length > 0) {
    const filePath = queue.shift();
    if (!filePath || analyzed.has(filePath)) {
      continue;
    }
    pending.delete(filePath);
    analyzed.add(filePath);

    let source: string;
    try {
      source = await readFile(filePath, "utf8");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Unable to read ${filePath}: ${reason}`, { cause: error });
    }

    const id = moduleId(canonicalRoot, filePath);
    builder.addNode({ id, absolutePath: filePath });

    const extraction = extractImports(source, filePath);
    warnings.push(...extraction.warnings);

    for (const reference of extraction.imports) {
      if (reference.typeOnly && !includeTypeImports) {
        continue;
      }

      const resolution = resolver.resolve(reference.specifier, filePath, reference.kind);
      let edge: DependencyEdge;
      if (resolution.status === "internal") {
        const targetPath = await canonicalPath(resolve(resolution.absolutePath));
        if (isExcluded(targetPath)) {
          continue;
        }
        const targetId = moduleId(canonicalRoot, targetPath);
        edge = {
          from: id,
          to: targetId,
          specifier: reference.specifier,
          kind: reference.kind,
          typeOnly: reference.typeOnly,
          status: "internal",
        };
        if (!analyzed.has(targetPath) && !pending.has(targetPath)) {
          pending.add(targetPath);
          queue.push(targetPath);
        }
      } else {
        edge = {
          from: id,
          specifier: reference.specifier,
          kind: reference.kind,
          typeOnly: reference.typeOnly,
          status: resolution.status,
        };
        if (resolution.status === "unresolved") {
          warnings.push(warningForUnresolved(filePath, reference, resolution.reason));
        }
      }
      builder.addEdge(edge);
    }
  }

  sortWarnings(warnings);
  return {
    graph: builder.build(),
    warnings,
  };
}
