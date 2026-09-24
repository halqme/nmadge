import { expect, test } from "bun:test";
import { analyze } from "../../src/analyzer/analyze.ts";
import type { DependencyKind } from "../../src/types.ts";
import { createFixture, removeFixture } from "../fixtures.ts";

test("classifies builtins, missing files, and optional type imports", async () => {
  const root = await createFixture({
    "main.ts": [
      'import type { Type } from "./types.js";',
      'import "node:fs";',
      'import "./missing.js";',
      'import "not-installed-package";',
    ].join("\n"),
    "types.ts": "export interface Type { value: string }\n",
  });

  try {
    const withTypes = await analyze("main.ts", { cwd: root });
    expect([...withTypes.graph.nodes.keys()]).toEqual(["main.ts", "types.ts"]);
    expect(withTypes.graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ specifier: "node:fs", status: "external" }),
        expect.objectContaining({ specifier: "./missing.js", status: "unresolved" }),
        expect.objectContaining({ specifier: "not-installed-package", status: "external" }),
        expect.objectContaining({ specifier: "./types.js", status: "internal", typeOnly: true }),
      ]),
    );
    expect(withTypes.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "unresolved-import" })]),
    );

    const withNpm = await analyze("main.ts", {
      cwd: root,
      includeNpm: true,
    });
    expect(withNpm.graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ specifier: "not-installed-package", status: "unresolved" }),
      ]),
    );

    const withoutTypes = await analyze("main.ts", {
      cwd: root,
      includeTypeImports: false,
    });
    expect([...withoutTypes.graph.nodes.keys()]).toEqual(["main.ts"]);
    expect(withoutTypes.graph.edges.some((edge) => edge.specifier === "./types.js")).toBe(false);
  } finally {
    await removeFixture(root);
  }
});

test("resolves modern module forms, path aliases, conditional exports, and package imports", async () => {
  const root = await createFixture({
    "package.json": JSON.stringify({
      name: "fixture-app",
      type: "module",
      imports: {
        "#foo": "./src/imported.ts",
      },
    }),
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: {
          "@/*": ["src/*"],
        },
      },
    }),
    "src/entry.ts": [
      'import "./foo.js";',
      'require("./common.cjs");',
      'import("./dynamic.js");',
      'export { foo } from "./reexport.js";',
      'import type { Foo } from "./types.js";',
      'import { aliased } from "@/aliased";',
      'import "#foo";',
      'import "fixture-package";',
      'require("fixture-package");',
      'require.resolve("fixture-package");',
    ].join("\n"),
    "src/foo.ts": "export const foo = true;\n",
    "src/common.cjs": "module.exports = {};\n",
    "src/dynamic.js": "export const dynamic = true;\n",
    "src/reexport.js": "export const foo = true;\n",
    "src/types.ts": "export interface Foo { value: string }\n",
    "src/aliased.ts": "export const aliased = true;\n",
    "src/imported.ts": "export const imported = true;\n",
    "node_modules/fixture-package/package.json": JSON.stringify({
      name: "fixture-package",
      type: "module",
      exports: {
        ".": {
          import: "./esm.js",
          require: "./cjs.cjs",
        },
      },
    }),
    "node_modules/fixture-package/esm.js": 'export const mode = "import";\n',
    "node_modules/fixture-package/cjs.cjs": 'module.exports = { mode: "require" };\n',
  });

  try {
    const result = await analyze("src/entry.ts", {
      cwd: root,
      includeNpm: true,
    });
    const edgeFor = (specifier: string, kind: DependencyKind) =>
      result.graph.edges.find(
        (edge) =>
          edge.from === "src/entry.ts" && edge.specifier === specifier && edge.kind === kind,
      );

    expect(edgeFor("./foo.js", "import")).toMatchObject({
      to: "src/foo.ts",
      status: "internal",
    });
    expect(edgeFor("./common.cjs", "require")).toMatchObject({
      to: "src/common.cjs",
      status: "internal",
    });
    expect(edgeFor("./dynamic.js", "dynamic-import")).toMatchObject({
      to: "src/dynamic.js",
      status: "internal",
    });
    expect(edgeFor("./reexport.js", "re-export")).toMatchObject({
      to: "src/reexport.js",
      status: "internal",
    });
    expect(edgeFor("./types.js", "import")).toMatchObject({
      to: "src/types.ts",
      status: "internal",
      typeOnly: true,
    });
    expect(edgeFor("@/aliased", "import")).toMatchObject({
      to: "src/aliased.ts",
      status: "internal",
    });
    expect(edgeFor("#foo", "import")).toMatchObject({
      to: "src/imported.ts",
      status: "internal",
    });
    expect(edgeFor("fixture-package", "import")).toMatchObject({
      to: "node_modules/fixture-package/esm.js",
      status: "internal",
    });
    expect(edgeFor("fixture-package", "require")).toMatchObject({
      to: "node_modules/fixture-package/cjs.cjs",
      status: "internal",
    });
    expect(edgeFor("fixture-package", "require-resolve")).toMatchObject({
      to: "node_modules/fixture-package/cjs.cjs",
      status: "internal",
    });
    expect(result.warnings).toEqual([]);
  } finally {
    await removeFixture(root);
  }
});

test("resolves JSON dependencies without unsupported-file warnings", async () => {
  const root = await createFixture({
    "src/entry.ts": ['require("../package.json");', 'require("../metadata");'].join("\n"),
    "package.json": JSON.stringify({ name: "fixture" }),
    "metadata.json": JSON.stringify({ version: 1 }),
  });

  try {
    const result = await analyze("src/entry.ts", { cwd: root });

    expect([...result.graph.nodes.keys()]).toEqual(["src/entry.ts"]);
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
