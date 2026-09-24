import { expect, test } from "bun:test";
import { analyze } from "../../src/analyzer/analyze.ts";
import { renderMermaid } from "../../src/render/mermaid.ts";
import { createFixture, removeFixture } from "../fixtures.ts";

test("renders Mermaid graphs with stable node IDs and configurable direction", async () => {
  const root = await createFixture({
    "src/a.ts": 'import "./b.js";\n',
    "src/b.ts": 'import "./c.js";\n',
    "src/c.ts": 'import "./a.js";\n',
    "src/leaf.ts": "export const leaf = true;\n",
  });

  try {
    const graph = (await analyze("src", { cwd: root })).graph;

    expect(renderMermaid(graph)).toContain('n0["src/a.ts"]');
    expect(renderMermaid(graph, { direction: "TB" })).toStartWith("flowchart TB");
  } finally {
    await removeFixture(root);
  }
});

test("escapes module paths in Mermaid output", async () => {
  const root = await createFixture({
    "a&b.ts": "export {};\n",
    "a<b>.ts": "export {};\n",
    'a"b.ts': "export {};\n",
  });

  try {
    const graph = (await analyze(["a&b.ts", "a<b>.ts", 'a"b.ts'], { cwd: root })).graph;
    const mermaid = renderMermaid(graph);

    expect(mermaid).toContain('["a&amp;b.ts"]');
    expect(mermaid).toContain('["a&lt;b&gt;.ts"]');
    expect(mermaid).toContain('["a&quot;b.ts"]');
  } finally {
    await removeFixture(root);
  }
});
