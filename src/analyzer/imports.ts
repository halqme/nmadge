import { parseSync } from "oxc-parser";
import { walk } from "oxc-walker";
import { SOURCE_EXTRACTOR_PLUGINS } from "../plugin/registry.ts";
import type { ScriptLanguage, SourceExtractor } from "../plugin/types.ts";
import type { AnalysisWarning, DependencyKind } from "../types.ts";

export interface ImportReference {
  specifier: string;
  kind: DependencyKind;
  typeOnly: boolean;
}

export interface ImportExtractionResult {
  imports: readonly ImportReference[];
  warnings: readonly AnalysisWarning[];
}

interface LocatedReference {
  reference: ImportReference;
  start: number;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function addReference(
  references: LocatedReference[],
  start: number,
  specifier: string,
  kind: DependencyKind,
  typeOnly: boolean,
): void {
  references.push({
    start,
    reference: { specifier, kind, typeOnly },
  });
}

function addDynamicWarning(warnings: AnalysisWarning[], filePath: string, kind: string): void {
  warnings.push({
    code: "dynamic-specifier",
    file: filePath,
    message: `${kind} uses a non-static module specifier`,
  });
}

function addCallReference(
  references: LocatedReference[],
  warnings: AnalysisWarning[],
  filePath: string,
  start: number,
  kind: "require" | "require-resolve",
  args: readonly unknown[],
): void {
  const argument = args.length === 1 ? args[0] : undefined;
  if (
    argument &&
    typeof argument === "object" &&
    "type" in argument &&
    argument.type === "Literal" &&
    "value" in argument &&
    typeof argument.value === "string"
  ) {
    addReference(references, start, argument.value, kind, false);
    return;
  }

  addDynamicWarning(warnings, filePath, kind);
}

function extractSourceImports(
  source: string,
  filePath: string,
  language?: ScriptLanguage,
): ImportExtractionResult {
  const result = parseSync(filePath, source, {
    astType: "ts",
    sourceType: "unambiguous",
    ...(language ? { lang: language } : {}),
  });
  const references: LocatedReference[] = [];
  const warnings: AnalysisWarning[] = result.errors.map((error) => ({
    code: "parse-error",
    file: filePath,
    message: error.message,
  }));

  for (const statement of result.module.staticImports) {
    const typeOnly =
      statement.entries.length > 0 && statement.entries.every((entry) => entry.isType);
    addReference(references, statement.start, statement.moduleRequest.value, "import", typeOnly);
  }

  for (const statement of result.module.staticExports) {
    const bySpecifier = new Map<string, { start: number; typeOnly: boolean }>();
    for (const entry of statement.entries) {
      if (!entry.moduleRequest) {
        continue;
      }

      const current = bySpecifier.get(entry.moduleRequest.value);
      if (current) {
        current.typeOnly = current.typeOnly && entry.isType;
      } else {
        bySpecifier.set(entry.moduleRequest.value, {
          start: entry.start,
          typeOnly: entry.isType,
        });
      }
    }

    for (const [specifier, entry] of bySpecifier) {
      addReference(references, entry.start, specifier, "re-export", entry.typeOnly);
    }
  }

  const needsAstWalk =
    result.errors.length > 0 ||
    result.module.dynamicImports.length > 0 ||
    source.includes("require") ||
    source.includes("\\u");

  if (needsAstWalk) {
    walk(result.program, {
      enter(node) {
        if (node.type === "ImportExpression") {
          const importSource = node.source;
          if (importSource.type === "Literal" && typeof importSource.value === "string") {
            addReference(references, node.start, importSource.value, "dynamic-import", false);
          } else {
            addDynamicWarning(warnings, filePath, "dynamic import");
          }
          return;
        }

        if (node.type !== "CallExpression") {
          return;
        }

        if (node.callee.type === "Identifier" && node.callee.name === "require") {
          addCallReference(references, warnings, filePath, node.start, "require", node.arguments);
          return;
        }

        if (
          node.callee.type === "MemberExpression" &&
          !node.callee.computed &&
          node.callee.object.type === "Identifier" &&
          node.callee.object.name === "require" &&
          node.callee.property.type === "Identifier" &&
          node.callee.property.name === "resolve"
        ) {
          addCallReference(
            references,
            warnings,
            filePath,
            node.start,
            "require-resolve",
            node.arguments,
          );
        }
      },
    });
  }

  references.sort((left, right) => {
    const startOrder = left.start - right.start;
    if (startOrder !== 0) {
      return startOrder;
    }
    const kindOrder = compareStrings(left.reference.kind, right.reference.kind);
    return kindOrder !== 0
      ? kindOrder
      : compareStrings(left.reference.specifier, right.reference.specifier);
  });
  warnings.sort((left, right) => {
    const codeOrder = compareStrings(left.code, right.code);
    return codeOrder !== 0 ? codeOrder : compareStrings(left.message, right.message);
  });

  return {
    imports: references.map(({ reference }) => reference),
    warnings,
  };
}

export const sourceExtractors: readonly SourceExtractor[] = SOURCE_EXTRACTOR_PLUGINS.map((plugin) =>
  plugin.create(extractSourceImports),
);

export function extractImports(source: string, filePath: string): ImportExtractionResult {
  const extractor = sourceExtractors.find((candidate) => candidate.supports(filePath));
  return extractor ? extractor.extract(source, filePath) : extractSourceImports(source, filePath);
}
