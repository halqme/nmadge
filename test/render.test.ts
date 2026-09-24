import { join } from "node:path";
import { expect, test } from "bun:test";
import { analyze } from "../src/analyzer/analyze.ts";
import { renderD2 } from "../src/render/d2.ts";
import { renderJson } from "../src/render/json.ts";
import { renderMermaid } from "../src/render/mermaid.ts";
import { renderSvg } from "../src/render/svg.ts";
import { renderText } from "../src/render/text.ts";
import type { ModuleGraph } from "../src/types.ts";
import { createFixture, removeFixture, writeFixtureFiles } from "./fixtures.ts";

test("renders graph formats with stable module ordering", async () => {
  const root = await createFixture({
    "src/a.ts": 'import "./b.js";\n',
    "src/b.ts": 'import "./c.js";\n',
    "src/c.ts": 'import "./a.js";\n',
    "src/leaf.ts": "export const leaf = true;\n",
  });

  try {
    const result = await analyze("src", { cwd: root });
    const modules = [...result.graph.nodes.keys()];
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
    expect(renderMermaid(result.graph, { direction: "TB" })).toStartWith("flowchart TB");
    expect(renderD2(result.graph)).toContain('n0: "src/a.ts"');
    const svg = renderSvg(result.graph, { direction: "BT" });
    expect(svg).not.toBe(renderSvg(result.graph));
    expect(svg).toContain("<marker");
    expect(svg).toContain("src/a.ts");
    expect(svg).toContain('<g transform="translate(0 24)">');
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

test("escapes module paths in SVG, Mermaid, and D2 output", async () => {
  const root = await createFixture({
    "a&b.ts": "export {};\n",
    "a<b>.ts": "export {};\n",
    'a"b.ts': "export {};\n",
  });

  try {
    const graph = (await analyze(["a&b.ts", "a<b>.ts", 'a"b.ts'], { cwd: root })).graph;
    const svg = renderSvg(graph);
    const mermaid = renderMermaid(graph);
    const d2 = renderD2(graph);

    expect(svg).toContain(">a&amp;b.ts<");
    expect(svg).toContain(">a&lt;b&gt;.ts<");
    expect(svg).toContain(">a&quot;b.ts<");
    expect(svg).not.toContain(">a&b.ts<");
    expect(svg).not.toContain(">a<b>.ts<");
    expect(svg).not.toContain('>a"b.ts<');

    expect(mermaid).toContain('["a&amp;b.ts"]');
    expect(mermaid).toContain('["a&lt;b&gt;.ts"]');
    expect(mermaid).toContain('["a&quot;b.ts"]');

    for (const module of graph.nodes.keys()) {
      expect(d2).toContain(`: ${JSON.stringify(module)}`);
    }
  } finally {
    await removeFixture(root);
  }
});

test("keeps rendered output stable across file and import declaration order", async () => {
  const root = await createFixture({
    "src/c.ts": 'import "./d.js";\n',
    "src/a.ts": ['import "./c.js";', 'import "./b.js";'].join("\n"),
    "src/d.ts": "export const d = true;\n",
    "src/b.ts": 'import "./d.js";\n',
  });

  const renderAll = (graph: ModuleGraph) => ({
    json: renderJson(graph),
    text: renderText(graph),
    mermaid: renderMermaid(graph),
    d2: renderD2(graph),
    svg: renderSvg(graph),
  });

  try {
    const first = renderAll((await analyze("src", { cwd: root })).graph);
    await removeFixture(join(root, "src"));
    await writeFixtureFiles(root, {
      "src/b.ts": 'import "./d.js";\n',
      "src/d.ts": "export const d = true;\n",
      "src/a.ts": ['import "./b.js";', 'import "./c.js";'].join("\n"),
      "src/c.ts": 'import "./d.js";\n',
    });
    const second = renderAll((await analyze("src", { cwd: root })).graph);

    expect(second).toEqual(first);
  } finally {
    await removeFixture(root);
  }
});
