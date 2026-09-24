import { expect, test } from "bun:test";
import { analyze } from "../../src/analyzer/analyze.ts";
import { renderSvg } from "../../src/render/svg.ts";
import { createFixture, removeFixture } from "../fixtures.ts";

test("renders SVG graphs with configurable direction and edge markers", async () => {
  const root = await createFixture({
    "src/a.ts": 'import "./b.js";\n',
    "src/b.ts": 'import "./c.js";\n',
    "src/c.ts": 'import "./a.js";\n',
    "src/leaf.ts": "export const leaf = true;\n",
  });

  try {
    const graph = (await analyze("src", { cwd: root })).graph;
    const svg = renderSvg(graph, { direction: "BT" });

    expect(svg).not.toBe(renderSvg(graph));
    expect(svg).toContain("<marker");
    expect(svg).toContain("src/a.ts");
    expect(svg).toContain('<g transform="translate(0 24)">');
  } finally {
    await removeFixture(root);
  }
});

test("escapes module paths in SVG output", async () => {
  const root = await createFixture({
    "a&b.ts": "export {};\n",
    "a<b>.ts": "export {};\n",
    'a"b.ts': "export {};\n",
  });

  try {
    const graph = (await analyze(["a&b.ts", "a<b>.ts", 'a"b.ts'], { cwd: root })).graph;
    const svg = renderSvg(graph);

    expect(svg).toContain(">a&amp;b.ts<");
    expect(svg).toContain(">a&lt;b&gt;.ts<");
    expect(svg).toContain(">a&quot;b.ts<");
    expect(svg).not.toContain(">a&b.ts<");
    expect(svg).not.toContain(">a<b>.ts<");
    expect(svg).not.toContain('>a"b.ts<');
  } finally {
    await removeFixture(root);
  }
});
