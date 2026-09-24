import { expect, test } from "bun:test";
import { extractImports } from "../../src/analyzer/imports.ts";

test("extracts static, dynamic, CommonJS, and type-only references", () => {
  const result = extractImports(
    [
      'import type { Value } from "./types.js";',
      'export * from "./exports.js";',
      'import("./dynamic.js");',
      'require("./common.js");',
      'require.resolve("./resolved.js");',
      "import(path);",
      "require(name);",
    ].join("\n"),
    "sample.ts",
  );

  expect(result.imports).toEqual([
    { specifier: "./types.js", kind: "import", typeOnly: true },
    { specifier: "./exports.js", kind: "re-export", typeOnly: false },
    { specifier: "./dynamic.js", kind: "dynamic-import", typeOnly: false },
    { specifier: "./common.js", kind: "require", typeOnly: false },
    { specifier: "./resolved.js", kind: "require-resolve", typeOnly: false },
  ]);
  expect(result.warnings).toHaveLength(2);
  expect(result.warnings.every((warning) => warning.code === "dynamic-specifier")).toBe(true);
});
