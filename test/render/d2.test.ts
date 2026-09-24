import { expect, test } from "bun:test";
import { analyze } from "../../src/analyzer/analyze.ts";
import { renderD2 } from "../../src/render/d2.ts";
import { createFixture, removeFixture } from "../fixtures.ts";

test("renders D2 graph nodes and dependencies", async () => {
  const root = await createFixture({
    "src/a.ts": 'import "./b.js";\n',
    "src/b.ts": 'import "./c.js";\n',
    "src/c.ts": 'import "./a.js";\n',
    "src/leaf.ts": "export const leaf = true;\n",
  });

  try {
    const graph = (await analyze("src", { cwd: root })).graph;

    expect(renderD2(graph)).toContain('n0: "src/a.ts"');
  } finally {
    await removeFixture(root);
  }
});

test("escapes module paths in D2 output", async () => {
  const root = await createFixture({
    "a&b.ts": "export {};\n",
    "a<b>.ts": "export {};\n",
    'a"b.ts': "export {};\n",
  });

  try {
    const graph = (await analyze(["a&b.ts", "a<b>.ts", 'a"b.ts'], { cwd: root })).graph;
    const d2 = renderD2(graph);

    for (const module of graph.nodes.keys()) {
      expect(d2).toContain(`: ${JSON.stringify(module)}`);
    }
  } finally {
    await removeFixture(root);
  }
});
