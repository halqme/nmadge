import { join } from "node:path";
import { expect, test } from "bun:test";
import { analyze } from "../../src/analyzer/analyze.ts";
import { renderD2 } from "../../src/render/d2.ts";
import { renderJson } from "../../src/render/json.ts";
import { renderMermaid } from "../../src/render/mermaid.ts";
import { renderSvg } from "../../src/render/svg.ts";
import { renderText } from "../../src/render/text.ts";
import type { ModuleGraph } from "../../src/types.ts";
import { createFixture, removeFixture, writeFixtureFiles } from "../fixtures.ts";

const renderAll = (graph: ModuleGraph) => ({
  json: renderJson(graph),
  text: renderText(graph),
  mermaid: renderMermaid(graph),
  d2: renderD2(graph),
  svg: renderSvg(graph),
});

test("keeps every renderer stable across file and import declaration order", async () => {
  const root = await createFixture({
    "src/c.ts": 'import "./d.js";\n',
    "src/a.ts": ['import "./c.js";', 'import "./b.js";'].join("\n"),
    "src/d.ts": "export const d = true;\n",
    "src/b.ts": 'import "./d.js";\n',
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
