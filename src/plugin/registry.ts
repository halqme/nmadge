import type { SourceExtractorPlugin } from "./types.ts";
import { vueSourceExtractorPlugin } from "./vue.ts";

export const SOURCE_EXTRACTOR_PLUGINS: readonly SourceExtractorPlugin[] = [
  vueSourceExtractorPlugin,
];
