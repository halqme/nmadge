import { describe, expect, test } from "bun:test";
import { analyze } from "../../src/analyzer/analyze.ts";
import type { DependencyEdge } from "../../src/types.ts";
import { analyzeFixture, createFixture, removeFixture } from "../fixtures.ts";

function expectEdge(
  result: Awaited<ReturnType<typeof analyzeFixture>>,
  expected: Pick<DependencyEdge, "from" | "specifier"> & Partial<DependencyEdge>,
): void {
  const edge = result.graph.edges.find(
    (candidate) =>
      candidate.from === expected.from &&
      candidate.specifier === expected.specifier &&
      (expected.kind === undefined || candidate.kind === expected.kind),
  );
  expect(edge).toMatchObject(expected);
}

describe("module resolution", () => {
  describe("relative dependencies", () => {
    test("resolves relative ESM dependencies", async () => {
      const result = await analyzeFixture("basic-esm", "src/index.ts");

      expectEdge(result, {
        from: "src/index.ts",
        specifier: "./lib/greet.js",
        kind: "import",
        to: "src/lib/greet.ts",
        status: "internal",
      });
      expect(result.warnings).toEqual([]);
    });

    test("maps JavaScript specifiers to TypeScript sources", async () => {
      const result = await analyzeFixture("basic-esm", "src/index.ts");

      expectEdge(result, {
        from: "src/index.ts",
        specifier: "./lib/user.js",
        kind: "import",
        to: "src/lib/user.ts",
        typeOnly: true,
        status: "internal",
      });
    });

    test("resolves dynamic imports to internal modules", async () => {
      const result = await analyzeFixture("basic-esm", "src/index.ts");

      expectEdge(result, {
        from: "src/index.ts",
        specifier: "./lib/lazy.js",
        kind: "dynamic-import",
        to: "src/lib/lazy.js",
        status: "internal",
      });
    });

    test("resolves CommonJS require dependencies from .cjs modules", async () => {
      const result = await analyzeFixture("basic-esm", "src/legacy.cjs");

      expectEdge(result, {
        from: "src/legacy.cjs",
        specifier: "./lib/legacy.cjs",
        kind: "require",
        to: "src/lib/legacy.cjs",
        status: "internal",
      });
    });

    test("resolves re-export dependencies", async () => {
      const result = await analyzeFixture("basic-esm", "src/index.ts");

      expectEdge(result, {
        from: "src/index.ts",
        specifier: "./lib/version.js",
        kind: "re-export",
        to: "src/lib/version.ts",
        status: "internal",
      });
    });

    test("resolves .mjs and .cjs specifiers to mixed TypeScript modules", async () => {
      const result = await analyzeFixture("mixed-modules", "src/index.ts");

      expectEdge(result, {
        from: "src/index.ts",
        specifier: "./esm.mjs",
        kind: "import",
        to: "src/esm.mts",
        status: "internal",
      });
      expectEdge(result, {
        from: "src/index.ts",
        specifier: "./common.cjs",
        kind: "import",
        to: "src/common.cts",
        status: "internal",
      });
    });

    test("resolves extensionless directories to their index module", async () => {
      const result = await analyzeFixture("directory-index", "src/index.ts");

      expectEdge(result, {
        from: "src/index.ts",
        specifier: "./formatters",
        kind: "import",
        to: "src/formatters/index.ts",
        status: "internal",
      });
    });

    test("omits type-only dependencies when requested", async () => {
      const result = await analyzeFixture("basic-esm", "src/index.ts", {
        includeTypeImports: false,
      });

      expect(result.graph.edges.some((edge) => edge.specifier === "./lib/user.js")).toBe(false);
      expect(result.graph.nodes.has("src/lib/user.ts")).toBe(false);
    });
  });

  describe("TypeScript path aliases", () => {
    test("resolves aliases declared in tsconfig paths", async () => {
      const result = await analyzeFixture("tsconfig-paths", "src/index.ts");

      expectEdge(result, {
        from: "src/index.ts",
        specifier: "@/lib/value",
        kind: "import",
        to: "src/lib/value.ts",
        status: "internal",
      });
    });

    test("resolves a nested project's alias from its tsconfig", async () => {
      const result = await analyzeFixture("tsconfig-paths", "packages/app/src/index.ts", {
        tsconfig: "packages/app/tsconfig.json",
      });

      expectEdge(result, {
        from: "packages/app/src/index.ts",
        specifier: "@models/user",
        kind: "import",
        to: "packages/models/src/user.ts",
        status: "internal",
      });
    });
  });

  describe("package resolution", () => {
    test("resolves package imports from the package imports map", async () => {
      const result = await analyzeFixture("package-imports", "src/index.ts");

      expectEdge(result, {
        from: "src/index.ts",
        specifier: "#internal/value",
        kind: "import",
        to: "src/internal/value.ts",
        status: "internal",
      });
    });

    test("selects the import condition from package exports", async () => {
      const result = await analyzeFixture("package-exports", "src/index.ts", {
        includeNpm: true,
      });

      expectEdge(result, {
        from: "src/index.ts",
        specifier: "fixture-package",
        kind: "import",
        to: "node_modules/fixture-package/import.js",
        status: "internal",
      });
    });

    test("selects the require condition from package exports", async () => {
      const result = await analyzeFixture("package-exports", "src/legacy.cjs", {
        includeNpm: true,
      });

      expectEdge(result, {
        from: "src/legacy.cjs",
        specifier: "fixture-package",
        kind: "require",
        to: "node_modules/fixture-package/require.cjs",
        status: "internal",
      });
    });

    test("resolves exported package subpaths for import", async () => {
      const result = await analyzeFixture("package-exports", "src/index.ts", {
        includeNpm: true,
      });

      expectEdge(result, {
        from: "src/index.ts",
        specifier: "fixture-package/feature",
        kind: "import",
        to: "node_modules/fixture-package/feature/import.js",
        status: "internal",
      });
    });

    test("resolves exported package subpaths for require.resolve", async () => {
      const result = await analyzeFixture("package-exports", "src/legacy.cjs", {
        includeNpm: true,
      });

      expectEdge(result, {
        from: "src/legacy.cjs",
        specifier: "fixture-package/feature",
        kind: "require-resolve",
        to: "node_modules/fixture-package/feature/require.cjs",
        status: "internal",
      });
    });

    test("resolves a package's self-reference through its exports", async () => {
      const result = await analyzeFixture("package-self-reference", "src/index.ts");

      expectEdge(result, {
        from: "src/index.ts",
        specifier: "self-reference-fixture/feature",
        kind: "import",
        to: "src/feature.ts",
        status: "internal",
      });
    });

    test("resolves workspace dependencies across package boundaries", async () => {
      const result = await analyzeFixture("workspace", "packages/app/src/index.ts", {
        includeNpm: true,
      });

      expectEdge(result, {
        from: "packages/app/src/index.ts",
        specifier: "@oxdg/shared",
        kind: "import",
        to: "packages/shared/src/index.ts",
        status: "internal",
      });
      expect(result.graph.nodes.has("packages/shared/src/index.ts")).toBe(true);
    });
  });

  describe("external and unresolved dependencies", () => {
    test("classifies builtins and bare packages as external by default", async () => {
      const root = await createFixture({
        "src/index.ts": 'import "node:fs";\nimport "not-installed-package";\n',
      });

      try {
        const result = await analyze("src/index.ts", { cwd: root });

        expect(result.graph.edges).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ specifier: "node:fs", status: "external" }),
            expect.objectContaining({ specifier: "not-installed-package", status: "external" }),
          ]),
        );
      } finally {
        await removeFixture(root);
      }
    });

    test("reports missing relative files as unresolved dependencies", async () => {
      const root = await createFixture({
        "src/index.ts": 'import "./missing.js";\n',
      });

      try {
        const result = await analyze("src/index.ts", { cwd: root });

        expect(result.graph.edges).toContainEqual(
          expect.objectContaining({ specifier: "./missing.js", status: "unresolved" }),
        );
        expect(result.warnings).toEqual(
          expect.arrayContaining([expect.objectContaining({ code: "unresolved-import" })]),
        );
      } finally {
        await removeFixture(root);
      }
    });

    test("reports missing bare packages as unresolved when npm analysis is enabled", async () => {
      const root = await createFixture({
        "src/index.ts": 'import "not-installed-package";\n',
      });

      try {
        const result = await analyze("src/index.ts", { cwd: root, includeNpm: true });

        expect(result.graph.edges).toContainEqual(
          expect.objectContaining({ specifier: "not-installed-package", status: "unresolved" }),
        );
      } finally {
        await removeFixture(root);
      }
    });

    test("treats JSON dependencies as external without unsupported-file warnings", async () => {
      const root = await createFixture({
        "src/index.ts": ['require("../package.json");', 'require("../metadata");'].join("\n"),
        "package.json": JSON.stringify({ name: "fixture" }),
        "metadata.json": JSON.stringify({ version: 1 }),
      });

      try {
        const result = await analyze("src/index.ts", { cwd: root });

        expect(result.graph.nodes.has("src/index.ts")).toBe(true);
        expect(result.graph.edges).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ specifier: "../package.json", status: "external" }),
            expect.objectContaining({ specifier: "../metadata", status: "external" }),
          ]),
        );
        expect(result.warnings).toEqual([]);
      } finally {
        await removeFixture(root);
      }
    });
  });
});
