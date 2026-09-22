import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "bun:test";
import { analyze } from "../src/analyzer/analyze.js";
import { extractImports } from "../src/analyzer/imports.js";
import { findCycles } from "../src/graph/cycles.js";
import { cyclicSubgraph, filterGraph } from "../src/graph/filter.js";
import {
  findDirectDependencies,
  findDirectDependents,
  findLeaves,
  findOrphans,
} from "../src/graph/queries.js";
import { renderD2 } from "../src/render/d2.js";
import { renderJson } from "../src/render/json.js";
import { renderMermaid } from "../src/render/mermaid.js";
import { renderSvg } from "../src/render/svg.js";
import { renderText } from "../src/render/text.js";

async function createFixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nmadge-test-"));
  for (const [relativePath, source] of Object.entries(files)) {
    const filePath = join(root, relativePath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, source, "utf8");
  }
  return root;
}

async function removeFixture(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}

test("analyzes cycles, queries the graph, and renders deterministic formats", async () => {
  const root = await createFixture({
    "src/a.ts": 'import "./b.js";\n',
    "src/b.ts": 'import "./c.js";\n',
    "src/c.ts": 'import "./a.js";\n',
    "src/leaf.ts": "export const leaf = true;\n",
  });

  try {
    const result = await analyze("src", { cwd: root });
    const modules = [...result.graph.nodes.keys()];

    expect(modules).toEqual(["src/a.ts", "src/b.ts", "src/c.ts", "src/leaf.ts"]);
    expect(findCycles(result.graph)).toEqual([{ modules: ["src/a.ts", "src/b.ts", "src/c.ts"] }]);
    expect(findDirectDependencies(result.graph, "src/a.ts")).toEqual(["src/b.ts"]);
    expect(findDirectDependents(result.graph, "src/a.ts")).toEqual(["src/c.ts"]);
    expect(findLeaves(result.graph)).toEqual(["src/leaf.ts"]);
    expect(findOrphans(result.graph)).toEqual(["src/leaf.ts"]);
    expect([...cyclicSubgraph(result.graph).nodes.keys()]).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
    ]);
    expect([...filterGraph(result.graph, (node) => node.id !== "src/c.ts").nodes.keys()]).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/leaf.ts",
    ]);

    const json = JSON.parse(renderJson(result.graph)) as {
      modules: { id: string }[];
      dependencies: { from: string; to?: string }[];
    };
    expect(json.modules.map((module) => module.id)).toEqual(modules);
    expect(json.dependencies[0]).toMatchObject({
      from: "src/a.ts",
      to: "src/b.ts",
    });
    expect(renderText(result.graph)).toContain("src/a.ts\n  -> src/b.ts");
    expect(renderMermaid(result.graph)).toContain('n0["src/a.ts"]');
    expect(renderD2(result.graph)).toContain('n0: "src/a.ts"');
    expect(renderSvg(result.graph)).toContain("<marker");
    expect(renderSvg(result.graph)).toContain("src/a.ts");
  } finally {
    await removeFixture(root);
  }
});

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
