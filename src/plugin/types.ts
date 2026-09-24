import type { ImportExtractionResult } from "../analyzer/imports.ts";

export type ScriptLanguage = "js" | "jsx" | "ts" | "tsx";

export type ScriptExtractor = (
  source: string,
  filePath: string,
  language: ScriptLanguage,
) => ImportExtractionResult;

export interface SourceExtractor {
  supports(filePath: string): boolean;

  extract(source: string, filePath: string): ImportExtractionResult;
}

export interface SourceExtractorPlugin {
  /**
   * Lowercase extensions handled by the created extractor. Its `supports()` must
   * match this set exactly, regardless of path extension casing.
   */
  readonly extensions: readonly string[];

  create(extractScript: ScriptExtractor): SourceExtractor;
}
