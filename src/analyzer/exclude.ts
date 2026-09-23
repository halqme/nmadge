import { relative, sep } from "node:path";
import ignore from "ignore";
import type { ExcludePattern } from "../types.ts";

export type ExcludeMatcher = (filePath: string) => boolean;

export function createExcludeMatcher(
  patterns: ExcludePattern | readonly ExcludePattern[] | undefined,
  rootDir: string,
): ExcludeMatcher {
  const gitignore = ignore().add(typeof patterns === "string" ? patterns : [...(patterns ?? [])]);

  return (filePath: string): boolean => {
    const relativePath = relative(rootDir, filePath).split(sep).join("/");
    return ignore.isPathValid(relativePath) && gitignore.ignores(relativePath);
  };
}
