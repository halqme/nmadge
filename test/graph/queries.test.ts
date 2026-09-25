import { expect, test } from "bun:test";
import { analyze } from "../../src/analyzer/analyze.ts";
import {
  findDirectDependencies,
  findDirectDependents,
  findLeaves,
  findOrphans,
} from "../../src/graph/queries.ts";
import { createFixture, removeFixture } from "../fixtures.ts";

test("finds direct dependencies, dependents, leaves, and orphans", async () => {
  const root = await createFixture({
    "src/a.ts": 'import "./b.js";\n',
    "src/b.ts": 'import "./c.js";\n',
    "src/c.ts": 'import "./a.js";\n',
    "src/leaf.ts": "export const leaf = true;\n",
  });

  try {
    const graph = (await analyze("src", { cwd: root })).graph;

    expect(findDirectDependencies(graph, "src/a.ts")).toEqual(["src/b.ts"]);
    expect(findDirectDependents(graph, "src/a.ts")).toEqual(["src/c.ts"]);
    expect(findLeaves(graph)).toEqual(["src/leaf.ts"]);
    expect(findOrphans(graph)).toEqual(["src/leaf.ts"]);
  } finally {
    await removeFixture(root);
  }
});
