import { extname, isAbsolute, resolve } from "node:path";
import { ResolverFactory } from "oxc-resolver";
import { DEFAULT_EXTENSIONS } from "./discover.js";
import type { AnalyzeOptions } from "../types.js";

export type ResolveResult =
  | { status: "internal"; absolutePath: string }
  | { status: "external" }
  | { status: "unresolved"; reason?: string };

export interface Resolver {
  resolve(specifier: string, importer: string): ResolveResult;
}

function normalizeExtensions(extensions: readonly string[]): string[] {
  const normalized = extensions.map((extension) =>
    extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`,
  );
  return ["", ...new Set(normalized)];
}

function isSupportedFile(filePath: string, extensions: ReadonlySet<string>): boolean {
  return extensions.has(extname(filePath).toLowerCase());
}

function isNodeModulesPath(filePath: string): boolean {
  const normalized = filePath.replaceAll("\\", "/");
  return normalized.split("/").includes("node_modules");
}

function isBareSpecifier(specifier: string): boolean {
  return (
    !specifier.startsWith(".") &&
    !specifier.startsWith("/") &&
    !isAbsolute(specifier) &&
    !specifier.startsWith("file:")
  );
}

function createResolverOptions(
  options: AnalyzeOptions,
  extensions: readonly string[],
): ConstructorParameters<typeof ResolverFactory>[0] {
  const tsconfig = options.tsconfig
    ? {
        configFile: resolve(options.cwd ?? process.cwd(), options.tsconfig),
        references: "auto" as const,
      }
    : ("auto" as const);

  return {
    builtinModules: true,
    extensions: normalizeExtensions(extensions),
    symlinks: false,
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
      ".ts": [".ts", ".tsx"],
      ".mts": [".mts", ".mjs"],
      ".cts": [".cts", ".cjs"],
    },
    tsconfig,
  };
}

export function createResolver(options: AnalyzeOptions): Resolver {
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS;
  const supportedExtensions = new Set(
    extensions.map((extension) =>
      extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`,
    ),
  );
  const factory = new ResolverFactory(createResolverOptions(options, extensions));
  const includeNpm = options.includeNpm ?? false;

  return {
    resolve(specifier, importer) {
      const result = factory.resolveFileSync(importer, specifier);

      if (result.builtin) {
        return { status: "external" };
      }

      if (result.path) {
        const absolutePath = resolve(result.path);
        if (!includeNpm && isNodeModulesPath(absolutePath)) {
          return { status: "external" };
        }
        if (!isSupportedFile(absolutePath, supportedExtensions)) {
          return {
            status: "unresolved",
            reason: `resolved file has an unsupported extension: ${absolutePath}`,
          };
        }
        return { status: "internal", absolutePath };
      }

      if (!includeNpm && isBareSpecifier(specifier) && !specifier.startsWith("#")) {
        return { status: "external" };
      }

      return {
        status: "unresolved",
        ...(result.error ? { reason: result.error } : {}),
      };
    },
  };
}
