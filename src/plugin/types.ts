import type { ImportExtractionResult } from "../analyzer/imports.js";

export interface SourceExtractor {
  supports(filePath: string): boolean;

  extract(source: string, filePath: string): ImportExtractionResult;
}
