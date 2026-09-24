import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyzer/analyze.ts";
import type { DependencyKind } from "../src/types.ts";

const fixtureRoot = fileURLToPath(new URL("./fixtures/vue-project/", import.meta.url));

test("discovers Vue files and extracts JS, TS, JSX, and TSX script dependencies", async () => {
  const result = await analyze(".", { cwd: fixtureRoot });
  const nodes = new Set(result.graph.nodes.keys());

  expect(nodes).toEqual(
    new Set([
      "src/main.ts",
      "src/components/App.vue",
      "src/components/Button.vue",
      "src/components/Child.vue",
      "src/components/JsxPanel.vue",
      "src/components/TsxPanel.vue",
      "src/components/Orphan.vue",
      "src/format.ts",
      "src/jsx-label.jsx",
      "src/plain.ts",
      "src/types.ts",
    ]),
  );

  const edgeFor = (from: string, specifier: string, kind: DependencyKind) =>
    result.graph.edges.find(
      (edge) => edge.from === from && edge.specifier === specifier && edge.kind === kind,
    );

  expect(edgeFor("src/main.ts", "./components/App.vue", "import")).toMatchObject({
    to: "src/components/App.vue",
    status: "internal",
  });
  expect(edgeFor("src/main.ts", "./components/Button", "import")).toMatchObject({
    to: "src/components/Button.vue",
    status: "internal",
  });
  expect(edgeFor("src/components/App.vue", "../plain.js", "import")).toMatchObject({
    to: "src/plain.ts",
    status: "internal",
  });
  expect(edgeFor("src/components/App.vue", "../types.ts", "import")).toMatchObject({
    to: "src/types.ts",
    status: "internal",
    typeOnly: true,
  });
  expect(edgeFor("src/components/App.vue", "../format.ts", "import")).toMatchObject({
    to: "src/format.ts",
    status: "internal",
  });
  expect(edgeFor("src/components/JsxPanel.vue", "../jsx-label.jsx", "import")).toMatchObject({
    to: "src/jsx-label.jsx",
    status: "internal",
  });
  expect(edgeFor("src/components/TsxPanel.vue", "./Child", "import")).toMatchObject({
    to: "src/components/Child.vue",
    status: "internal",
  });
  expect(result.warnings).toEqual([]);
});

test("an explicit extension list replaces default Vue extensions", async () => {
  const result = await analyze("src/main.ts", {
    cwd: fixtureRoot,
    extensions: ["ts"],
  });

  expect([...result.graph.nodes.keys()]).toEqual(["src/main.ts"]);
  expect(result.graph.edges).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ specifier: "./components/App.vue", status: "unresolved" }),
      expect.objectContaining({ specifier: "./components/Button", status: "unresolved" }),
    ]),
  );
});
