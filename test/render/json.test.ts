import { expect, test } from "bun:test";
import { analyze } from "../../src/analyzer/analyze.ts";
import { renderJson } from "../../src/render/json.ts";
import { createFixture, removeFixture } from "../fixtures.ts";

test("renders JSON with stable module and dependency ordering", async () => {
  const root = await createFixture({
    "src/a.ts": 'import "./b.js";\n',
    "src/b.ts": 'import "./c.js";\n',
    "src/c.ts": 'import "./a.js";\n',
    "src/leaf.ts": "export const leaf = true;\n",
  });

  try {
    const graph = (await analyze("src", { cwd: root })).graph;
    const modules = [...graph.nodes.keys()];
    const json = JSON.parse(renderJson(graph)) as {
      modules: { id: string }[];
      dependencies: { from: string; to?: string }[];
    };

    expect(json.modules.map((module) => module.id)).toEqual(modules);
    expect(json.dependencies[0]).toMatchObject({
      from: "src/a.ts",
      to: "src/b.ts",
    });
  } finally {
    await removeFixture(root);
  }
});
