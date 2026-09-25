import { expect, test } from "bun:test";
import { analyze } from "../../src/analyzer/analyze.ts";
import { renderText } from "../../src/render/text.ts";
import type { ModuleGraph } from "../../src/types.ts";
import { createFixture, removeFixture } from "../fixtures.ts";

test("renders modules and internal dependencies in stable order", async () => {
  const root = await createFixture({
    "src/a.ts": 'import "./b.js";\n',
    "src/b.ts": 'import "./c.js";\n',
    "src/c.ts": 'import "./a.js";\n',
    "src/leaf.ts": "export const leaf = true;\n",
  });

  try {
    const graph = (await analyze("src", { cwd: root })).graph;

    expect(renderText(graph)).toContain("src/a.ts\n  -> src/b.ts");
  } finally {
    await removeFixture(root);
  }
});

test("renders empty graphs as empty text", () => {
  const graph: ModuleGraph = { rootDir: "/project", nodes: new Map(), edges: [] };

  expect(renderText(graph)).toBe("");
});

test("omits external and unresolved edges while retaining source modules", () => {
  const graph: ModuleGraph = {
    rootDir: "/project",
    nodes: new Map<string, { id: string; absolutePath: string }>([
      ["src/entry.ts", { id: "src/entry.ts", absolutePath: "/project/src/entry.ts" }],
      [
        "src/standalone.ts",
        { id: "src/standalone.ts", absolutePath: "/project/src/standalone.ts" },
      ],
    ]),
    edges: [
      {
        from: "src/entry.ts",
        specifier: "external-package",
        kind: "import",
        typeOnly: false,
        status: "external",
      },
      {
        from: "src/entry.ts",
        specifier: "./missing.js",
        kind: "import",
        typeOnly: false,
        status: "unresolved",
      },
    ],
  };

  expect(renderText(graph)).toBe("src/entry.ts\n\nsrc/standalone.ts");
});
