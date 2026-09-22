import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import type { AnalyzeInput } from "../types.js";

export const DEFAULT_EXTENSIONS = [
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
] as const;

export interface RequiredDiscoveryOptions {
  cwd: string;
  includeNpm: boolean;
  extensions: readonly string[];
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeExtensions(extensions: readonly string[]): ReadonlySet<string> {
  return new Set(
    extensions.map((extension) =>
      extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`,
    ),
  );
}

function isSupportedFile(filePath: string, extensions: ReadonlySet<string>): boolean {
  return extensions.has(extname(filePath).toLowerCase());
}

function isNodeModulesPath(filePath: string): boolean {
  return filePath.replaceAll("\\", "/").split("/").includes("node_modules");
}

async function addDirectoryFiles(
  directory: string,
  extensions: ReadonlySet<string>,
  includeNpm: boolean,
  files: Set<string>,
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => compareStrings(left.name, right.name));

  for (const entry of entries) {
    if (entry.name === ".git" || (!includeNpm && entry.name === "node_modules")) {
      continue;
    }

    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      await addDirectoryFiles(entryPath, extensions, includeNpm, files);
      continue;
    }

    if (entry.isFile()) {
      if (isSupportedFile(entryPath, extensions)) {
        files.add(await realpath(entryPath));
      }
      continue;
    }

    if (!entry.isSymbolicLink()) {
      continue;
    }

    const target = await stat(entryPath);
    if (target.isFile() && isSupportedFile(entryPath, extensions)) {
      files.add(await realpath(entryPath));
    }
  }
}

async function inspectInput(
  inputPath: string,
  extensions: ReadonlySet<string>,
  includeNpm: boolean,
  files: Set<string>,
): Promise<void> {
  const absolutePath = resolve(inputPath);
  if (!includeNpm && isNodeModulesPath(absolutePath)) {
    return;
  }
  const link = await lstat(absolutePath);

  if (link.isSymbolicLink()) {
    const target = await stat(absolutePath);
    if (target.isFile() && isSupportedFile(absolutePath, extensions)) {
      files.add(await realpath(absolutePath));
    }
    return;
  }

  if (link.isFile()) {
    if (isSupportedFile(absolutePath, extensions)) {
      files.add(await realpath(absolutePath));
    }
    return;
  }

  if (link.isDirectory()) {
    await addDirectoryFiles(absolutePath, extensions, includeNpm, files);
  }
}

export async function discoverFiles(
  input: AnalyzeInput,
  options: RequiredDiscoveryOptions,
): Promise<string[]> {
  const extensions = normalizeExtensions(options.extensions);
  const inputs = typeof input === "string" ? [input] : input;
  const files = new Set<string>();

  for (const entry of inputs) {
    const absolutePath = resolve(options.cwd, entry);
    try {
      await inspectInput(absolutePath, extensions, options.includeNpm, files);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        throw new Error(`Input path does not exist: ${entry}`);
      }
      throw error;
    }
  }

  return [...files].sort(compareStrings);
}
