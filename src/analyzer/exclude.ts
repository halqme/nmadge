import type { ExcludePattern } from "../types.ts";

export type ExcludeMatcher = (filePath: string) => boolean;

interface PatternMatcher {
  test(value: string): boolean;
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/");
}

function escapeRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function globToRegex(pattern: string): RegExp {
  const normalized = normalizePath(pattern).replace(/^\.\//, "");
  let source = "";

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === undefined) {
      continue;
    }

    if (character === "*") {
      if (normalized[index + 1] === "*") {
        if (normalized[index + 2] === "/") {
          source += "(?:.*/)?";
          index += 2;
        } else {
          source += ".*";
          index += 1;
        }
      } else {
        source += "[^/]*";
      }
      continue;
    }

    if (character === "?") {
      source += "[^/]";
      continue;
    }

    if (character === "[") {
      const closing = normalized.indexOf("]", index + 1);
      if (closing > index + 1) {
        const content = normalized.slice(index + 1, closing);
        source += `[${content.replaceAll("\\", "\\\\")}]`;
        index = closing;
        continue;
      }
    }

    source += escapeRegex(character);
  }

  return new RegExp(`${source}$`);
}

function regexLiteral(pattern: string): RegExp | undefined {
  if (!pattern.startsWith("/")) {
    return undefined;
  }

  const closingSlash = pattern.lastIndexOf("/");
  if (closingSlash <= 0) {
    return undefined;
  }

  const source = pattern.slice(1, closingSlash);
  const flags = pattern.slice(closingSlash + 1);
  if (!/^[dgimsuvy]*$/.test(flags)) {
    return undefined;
  }

  return new RegExp(source, flags);
}

function looksLikeRegex(pattern: string): boolean {
  return /[\\^$()+|{}]/.test(pattern) || pattern.includes(".*");
}

function createPatternMatcher(pattern: ExcludePattern): PatternMatcher {
  if (pattern instanceof RegExp) {
    return {
      test(value: string): boolean {
        pattern.lastIndex = 0;
        return pattern.test(value);
      },
    };
  }

  const regex =
    regexLiteral(pattern) ?? (looksLikeRegex(pattern) ? new RegExp(pattern) : undefined);
  if (regex !== undefined) {
    return {
      test(value: string): boolean {
        regex.lastIndex = 0;
        return regex.test(value);
      },
    };
  }

  const glob = globToRegex(pattern);
  return {
    test(value: string): boolean {
      return glob.test(value);
    },
  };
}

export function createExcludeMatcher(
  patterns: ExcludePattern | readonly ExcludePattern[] = [],
): ExcludeMatcher {
  const values = typeof patterns === "string" || patterns instanceof RegExp ? [patterns] : patterns;
  const matchers = values.map((pattern) => {
    if (typeof pattern === "string" && pattern.length === 0) {
      throw new Error("Exclude patterns must not be empty");
    }
    return createPatternMatcher(pattern);
  });

  return (filePath: string): boolean => {
    const normalized = normalizePath(filePath);
    return matchers.some((matcher) => matcher.test(normalized));
  };
}
