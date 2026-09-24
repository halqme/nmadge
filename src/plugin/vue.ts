import { extname } from "node:path";
import type { ImportExtractionResult } from "../analyzer/imports.ts";
import type { SourceExtractor } from "./types.ts";

export type VueScriptLanguage = "js" | "jsx" | "ts" | "tsx";

type ScriptExtractor = (
  source: string,
  filePath: string,
  language: VueScriptLanguage,
) => ImportExtractionResult;

interface VueTag {
  name: string;
  closing: boolean;
  selfClosing: boolean;
  start: number;
  end: number;
  attributes: string;
}

interface VueScriptBlock {
  source: string;
  language: VueScriptLanguage;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function findTagEnd(source: string, start: number): number {
  let quote: string | undefined;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) {
        quote = undefined;
      }
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return -1;
}

function findNextVueTag(source: string, start: number): VueTag | undefined {
  let position = source.indexOf("<", start);
  while (position >= 0) {
    if (source.startsWith("<!--", position)) {
      const commentEnd = source.indexOf("-->", position + 4);
      position = commentEnd < 0 ? -1 : source.indexOf("<", commentEnd + 3);
      continue;
    }

    const match = /^<\s*(\/?)\s*([a-z][\w:-]*)/i.exec(source.slice(position));
    if (!match) {
      position = source.indexOf("<", position + 1);
      continue;
    }

    const tagEnd = findTagEnd(source, position + match[0].length);
    if (tagEnd < 0) {
      return undefined;
    }
    const rawTag = source.slice(position, tagEnd + 1);
    return {
      name: match[2]?.toLowerCase() ?? "",
      closing: Boolean(match[1]),
      selfClosing: /\/\s*>$/.test(rawTag),
      start: position,
      end: tagEnd + 1,
      attributes: source.slice(position + match[0].length, tagEnd),
    };
  }
  return undefined;
}

function findVueBlockClose(source: string, name: string, start: number): VueTag | undefined {
  const nestedTemplates = name === "template";
  let depth = 1;
  let position = start;
  let tag = findNextVueTag(source, position);
  while (tag) {
    if (tag.name === name) {
      if (tag.closing) {
        if (!nestedTemplates || --depth === 0) {
          return tag;
        }
      } else if (nestedTemplates && !tag.selfClosing) {
        depth += 1;
      }
    }
    position = tag.end;
    tag = findNextVueTag(source, position);
  }
  return undefined;
}

function vueScriptLanguage(attributes: string): VueScriptLanguage {
  const match = /(?:^|\s)lang\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s/>]+))/i.exec(attributes);
  const value = (match?.[1] ?? match?.[2] ?? match?.[3] ?? "js").toLowerCase();
  if (value === "jsx" || value === "ts" || value === "tsx") {
    return value;
  }
  return value === "typescript" ? "ts" : "js";
}

function vueScriptBlocks(source: string): VueScriptBlock[] {
  const blocks: VueScriptBlock[] = [];
  let position = 0;
  let tag = findNextVueTag(source, position);
  while (tag) {
    if (tag.closing) {
      position = tag.end;
    } else if (tag.name === "script") {
      const close = tag.selfClosing ? undefined : findVueBlockClose(source, tag.name, tag.end);
      blocks.push({
        source: source.slice(tag.end, close?.start ?? source.length),
        language: vueScriptLanguage(tag.attributes),
      });
      if (!close) {
        break;
      }
      position = close.end;
    } else if (tag.selfClosing) {
      position = tag.end;
    } else {
      const close = findVueBlockClose(source, tag.name, tag.end);
      if (!close) {
        break;
      }
      position = close.end;
    }
    tag = findNextVueTag(source, position);
  }
  return blocks;
}

export function createVueSourceExtractor(extractScript: ScriptExtractor): SourceExtractor {
  return {
    supports(filePath) {
      return extname(filePath).toLowerCase() === ".vue";
    },
    extract(source, filePath) {
      const extractions = vueScriptBlocks(source).map((block) =>
        extractScript(block.source, filePath, block.language),
      );
      const imports = extractions.flatMap((extraction) => extraction.imports);
      const warnings = extractions.flatMap((extraction) => extraction.warnings);
      warnings.sort((left, right) => {
        const codeOrder = compareStrings(left.code, right.code);
        return codeOrder !== 0 ? codeOrder : compareStrings(left.message, right.message);
      });
      return { imports, warnings };
    },
  };
}
