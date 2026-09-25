import { expect, test } from "bun:test";
import { analyze } from "../../src/analyzer/analyze.ts";
import { findCycles } from "../../src/graph/cycles.ts";
import { cyclicSubgraph, filterGraph } from "../../src/graph/filter.ts";
import { createFixture, removeFixture } from "../fixtures.ts";

test("analyzes cycle membership and graph filtering", async () => {
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
  } finally {
    await removeFixture(root);
  }
});

test("finds self, independent, and multiple cycles deterministically", async () => {
  const root = await createFixture({
    "cycles/self.ts": 'import "./self.js";\n',
    "cycles/independent-a.ts": 'import "./independent-b.js";\n',
    "cycles/independent-b.ts": 'import "./independent-a.js";\n',
    "cycles/independent-c.ts": 'import "./independent-d.js";\n',
    "cycles/independent-d.ts": 'import "./independent-c.js";\n',
    "cycles/scc-a.ts": ['import "./scc-b.js";', 'import "./scc-c.js";'].join("\n"),
    "cycles/scc-b.ts": ['import "./scc-a.js";', 'import "./scc-c.js";'].join("\n"),
    "cycles/scc-c.ts": 'import "./scc-a.js";\n',
  });

  try {
    const result = await analyze("cycles", { cwd: root });
    const cycles = findCycles(result.graph);

    expect(cycles).toEqual([
      { modules: ["cycles/independent-a.ts", "cycles/independent-b.ts"] },
      { modules: ["cycles/independent-c.ts", "cycles/independent-d.ts"] },
      { modules: ["cycles/scc-a.ts", "cycles/scc-b.ts"] },
      {
        modules: ["cycles/scc-a.ts", "cycles/scc-b.ts", "cycles/scc-c.ts"],
      },
      { modules: ["cycles/scc-a.ts", "cycles/scc-c.ts"] },
      { modules: ["cycles/self.ts"] },
    ]);
    expect(new Set(cycles.map((cycle) => cycle.modules.join("\u0000"))).size).toBe(cycles.length);
  } finally {
    await removeFixture(root);
  }
});
