import * as OxcParser from "oxc-parser";
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

type ParserOptions = NonNullable<Parameters<typeof OxcParser.parseSync>[2]>;
type StandardParseResult = ReturnType<typeof OxcParser.parseSync>;

interface LazyParseResult {
  module: StandardParseResult["module"];
  errors: StandardParseResult["errors"];
  visit(visitor: unknown): void;
  dispose(): void;
}

type LazyVisitorConstructor = new (visitor: Record<string, (node: unknown) => void>) => unknown;

const experimentalParser = OxcParser as typeof OxcParser & {
  experimentalGetLazyVisitor?: () => LazyVisitorConstructor;
};

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

function nodeType(value: unknown): string | undefined {
  return value && typeof value === "object" && "type" in value && typeof value.type === "string"
    ? value.type
    : undefined;
}

function stringLiteralValue(value: unknown): string | undefined {
  const type = nodeType(value);
  if (
    (type === "Literal" || type === "StringLiteral") &&
    value &&
    typeof value === "object" &&
    "value" in value &&
    typeof value.value === "string"
  ) {
    return value.value;
  }
  return undefined;
}

function identifierName(value: unknown): string | undefined {
  const type = nodeType(value);
  if (
    (type === "Identifier" || type === "IdentifierReference" || type === "IdentifierName") &&
    value &&
    typeof value === "object" &&
    "name" in value &&
    typeof value.name === "string"
  ) {
    return value.name;
  }
  return undefined;
}

function propertyValue(value: unknown, name: string): unknown {
  return value && typeof value === "object" && name in value
    ? (value as Record<string, unknown>)[name]
    : undefined;
}

function addCallReference(
  references: LocatedReference[],
  warnings: AnalysisWarning[],
  filePath: string,
  start: number,
  kind: "require" | "require-resolve",
  args: readonly unknown[],
): void {
  const specifier = args.length === 1 ? stringLiteralValue(args[0]) : undefined;
  if (specifier !== undefined) {
    addReference(references, start, specifier, kind, false);
    return;
  }

  addDynamicWarning(warnings, filePath, kind);
}

function scanDependencyNode(
  node: unknown,
  references: LocatedReference[],
  warnings: AnalysisWarning[],
  filePath: string,
): void {
  const type = nodeType(node);
  if (type === "ImportExpression") {
    const source = stringLiteralValue(propertyValue(node, "source"));
    const start = propertyValue(node, "start");
    if (typeof start !== "number") {
      return;
    }
    if (source !== undefined) {
      addReference(references, start, source, "dynamic-import", false);
    } else {
      addDynamicWarning(warnings, filePath, "dynamic import");
    }
    return;
  }

  if (type !== "CallExpression") {
    return;
  }

  const start = propertyValue(node, "start");
  const callee = propertyValue(node, "callee");
  const args = propertyValue(node, "arguments");
  if (typeof start !== "number" || !Array.isArray(args)) {
    return;
  }

  if (identifierName(callee) === "require") {
    addCallReference(references, warnings, filePath, start, "require", args);
    return;
  }

  const calleeType = nodeType(callee);
  const isStaticMember =
    calleeType === "StaticMemberExpression" ||
    (calleeType === "MemberExpression" && propertyValue(callee, "computed") === false);
  if (
    isStaticMember &&
    identifierName(propertyValue(callee, "object")) === "require" &&
    identifierName(propertyValue(callee, "property")) === "resolve"
  ) {
    addCallReference(references, warnings, filePath, start, "require-resolve", args);
  }
}

function canUseLazyParser(): boolean {
  return (
    OxcParser.rawTransferSupported() &&
    typeof experimentalParser.experimentalGetLazyVisitor === "function"
  );
}

function parseSource(
  source: string,
  filePath: string,
  language?: ScriptLanguage,
): { result: StandardParseResult | LazyParseResult; lazy: boolean } {
  const options: ParserOptions = {
    astType: "ts",
    sourceType: "unambiguous",
    ...(language ? { lang: language } : {}),
  };

  if (!canUseLazyParser()) {
    return { result: OxcParser.parseSync(filePath, source, options), lazy: false };
  }

  const lazyOptions = { ...options, experimentalLazy: true } as ParserOptions;
  return {
    result: OxcParser.parseSync(filePath, source, lazyOptions) as unknown as LazyParseResult,
    lazy: true,
  };
}

function scanLazyAst(
  result: LazyParseResult,
  references: LocatedReference[],
  warnings: AnalysisWarning[],
  filePath: string,
): void {
  const Visitor = experimentalParser.experimentalGetLazyVisitor?.();
  if (!Visitor) {
    throw new Error("Oxc lazy visitor is unavailable");
  }

  result.visit(
    new Visitor({
      ImportExpression(node) {
        scanDependencyNode(node, references, warnings, filePath);
      },
      CallExpression(node) {
        scanDependencyNode(node, references, warnings, filePath);
      },
    }),
  );
}

function extractSourceImports(
  source: string,
  filePath: string,
  language?: ScriptLanguage,
): ImportExtractionResult {
  const { result, lazy } = parseSource(source, filePath, language);

  try {
    const module = result.module;
    const errors = result.errors;
    const references: LocatedReference[] = [];
    const warnings: AnalysisWarning[] = errors.map((error) => ({
      code: "parse-error",
      file: filePath,
      message: error.message,
    }));

    for (const statement of module.staticImports) {
      const typeOnly =
        statement.entries.length > 0 && statement.entries.every((entry) => entry.isType);
      addReference(references, statement.start, statement.moduleRequest.value, "import", typeOnly);
    }

    for (const statement of module.staticExports) {
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

    const needsAstScan =
      errors.length > 0 ||
      module.dynamicImports.length > 0 ||
      source.includes("require") ||
      source.includes("\\u");

    if (needsAstScan) {
      if (lazy) {
        scanLazyAst(result as LazyParseResult, references, warnings, filePath);
      } else {
        const program = (result as StandardParseResult).program;
        walk(program, {
          enter(node) {
            scanDependencyNode(node, references, warnings, filePath);
          },
        });
      }
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
  } finally {
    if (lazy) {
      (result as LazyParseResult).dispose();
    }
  }
}

export const sourceExtractors: readonly SourceExtractor[] = SOURCE_EXTRACTOR_PLUGINS.map((plugin) =>
  plugin.create(extractSourceImports),
);

export function extractImports(source: string, filePath: string): ImportExtractionResult {
  const extractor = sourceExtractors.find((candidate) => candidate.supports(filePath));
  return extractor ? extractor.extract(source, filePath) : extractSourceImports(source, filePath);
}
