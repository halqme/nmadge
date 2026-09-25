import { describe, expect, test } from "bun:test";
import { extractImports } from "../../src/analyzer/imports.ts";

describe("dependency extraction", () => {
  test("extracts static ESM imports", () => {
    const result = extractImports('import { value } from "./value.js";', "sample.ts");

    expect(result.imports).toEqual([{ specifier: "./value.js", kind: "import", typeOnly: false }]);
    expect(result.warnings).toEqual([]);
  });

  test("preserves type-only import metadata", () => {
    const result = extractImports('import type { Value } from "./types.js";', "sample.ts");

    expect(result.imports).toEqual([{ specifier: "./types.js", kind: "import", typeOnly: true }]);
  });

  test("extracts re-export dependencies", () => {
    const result = extractImports('export * from "./exports.js";', "sample.ts");

    expect(result.imports).toEqual([
      { specifier: "./exports.js", kind: "re-export", typeOnly: false },
    ]);
  });

  test("extracts dynamic import dependencies", () => {
    const result = extractImports('import("./dynamic.js");', "sample.ts");

    expect(result.imports).toEqual([
      { specifier: "./dynamic.js", kind: "dynamic-import", typeOnly: false },
    ]);
    expect(result.warnings).toEqual([]);
  });

  test("extracts require and require.resolve dependencies", () => {
    const result = extractImports(
      ['require("./common.js");', 'require.resolve("./resolved.js");'].join("\n"),
      "sample.ts",
    );

    expect(result.imports).toEqual([
      { specifier: "./common.js", kind: "require", typeOnly: false },
      { specifier: "./resolved.js", kind: "require-resolve", typeOnly: false },
    ]);
  });

  test("warns when dynamic imports and require calls use non-static specifiers", () => {
    const result = extractImports("import(path);\nrequire(name);", "sample.ts");

    expect(result.imports).toEqual([]);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.every((warning) => warning.code === "dynamic-specifier")).toBe(true);
  });
});
