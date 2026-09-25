import { describe, expect, test } from "bun:test";
import { analyze } from "../../src/analyzer/analyze.ts";
import type { DependencyEdge } from "../../src/types.ts";
import { analyzeFixture, createFixture, removeFixture } from "../fixtures.ts";

function expectEdge(
  result: Awaited<ReturnType<typeof analyzeFixture>>,
  expected: Pick<DependencyEdge, "from" | "specifier"> & Partial<DependencyEdge>,
): void {
  const edge = result.graph.edges.find(
    (candidate) =>
      candidate.from === expected.from &&
      candidate.specifier === expected.specifier &&
      (expected.kind === undefined || candidate.kind === expected.kind),
  );
  expect(edge).toMatchObject(expected);
}

describe("Vue project fixture", () => {
  test("discovers Vue single-file components alongside JavaScript and TypeScript", async () => {
    const result = await analyzeFixture("vue-project");
    const vueFiles = [...result.graph.nodes.keys()].filter((id) => id.endsWith(".vue")).sort();

    expect(vueFiles).toEqual([
      "src/components/App.vue",
      "src/components/Button.vue",
      "src/components/Child.vue",
      "src/components/JsxPanel.vue",
      "src/components/Orphan.vue",
      "src/components/TsxPanel.vue",
    ]);
    expect(result.graph.nodes.has("src/main.ts")).toBe(true);
    expect(result.graph.nodes.has("src/legacy.js")).toBe(true);
  });

  test("resolves JavaScript and TypeScript imports to Vue components", async () => {
    const result = await analyzeFixture("vue-project", ["src/main.ts", "src/legacy.js"]);

    expectEdge(result, {
      from: "src/main.ts",
      specifier: "./components/App.vue",
      kind: "import",
      to: "src/components/App.vue",
      status: "internal",
    });
    expectEdge(result, {
      from: "src/legacy.js",
      specifier: "./components/App.vue",
      kind: "import",
      to: "src/components/App.vue",
      status: "internal",
    });
  });

  test("resolves extensionless imports to Vue components", async () => {
    const result = await analyzeFixture("vue-project", "src/main.ts");

    expectEdge(result, {
      from: "src/main.ts",
      specifier: "./components/Button",
      kind: "import",
      to: "src/components/Button.vue",
      status: "internal",
    });
    expectEdge(result, {
      from: "src/components/TsxPanel.vue",
      specifier: "./Child",
      kind: "import",
      to: "src/components/Child.vue",
      status: "internal",
    });
  });

  test("extracts dependencies from both script and script setup blocks", async () => {
    const result = await analyzeFixture("vue-project", "src/components/App.vue");

    expectEdge(result, {
      from: "src/components/App.vue",
      specifier: "../plain.js",
      kind: "import",
      to: "src/plain.ts",
      status: "internal",
    });
    expectEdge(result, {
      from: "src/components/App.vue",
      specifier: "../format.ts",
      kind: "import",
      to: "src/format.ts",
      status: "internal",
    });
    expect(
      result.graph.edges.filter((edge) => edge.from === "src/components/App.vue"),
    ).toHaveLength(3);
    expect(result.warnings).toEqual([]);
  });

  test("resolves JSX and TSX script dependencies", async () => {
    const result = await analyzeFixture("vue-project", [
      "src/components/JsxPanel.vue",
      "src/components/TsxPanel.vue",
    ]);

    expectEdge(result, {
      from: "src/components/JsxPanel.vue",
      specifier: "../jsx-label.jsx",
      kind: "import",
      to: "src/jsx-label.jsx",
      status: "internal",
    });
    expectEdge(result, {
      from: "src/components/TsxPanel.vue",
      specifier: "./Child",
      kind: "import",
      to: "src/components/Child.vue",
      status: "internal",
    });
    expect(result.warnings).toEqual([]);
  });

  test("preserves type-only imports from Vue scripts", async () => {
    const result = await analyzeFixture("vue-project", [
      "src/components/App.vue",
      "src/components/TsxPanel.vue",
    ]);

    expectEdge(result, {
      from: "src/components/App.vue",
      specifier: "../types.ts",
      kind: "import",
      to: "src/types.ts",
      typeOnly: true,
      status: "internal",
    });
    expectEdge(result, {
      from: "src/components/TsxPanel.vue",
      specifier: "../types.ts",
      kind: "import",
      to: "src/types.ts",
      typeOnly: true,
      status: "internal",
    });
  });

  test("an explicit extension list replaces the default Vue extensions", async () => {
    const result = await analyzeFixture("vue-project", "src/main.ts", {
      extensions: ["ts"],
    });

    expect(result.graph.nodes.has("src/main.ts")).toBe(true);
    expect(result.graph.nodes.has("src/components/App.vue")).toBe(false);
    expect(result.graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ specifier: "./components/App.vue", status: "unresolved" }),
        expect.objectContaining({ specifier: "./components/Button", status: "unresolved" }),
      ]),
    );
  });
});

describe("Vue script extraction boundaries", () => {
  test("ignores tag-like markup inside templates and script strings", async () => {
    const root = await createFixture({
      "src/main.ts": 'import "./Component.vue";\n',
      "src/Component.vue": `<template>
  <div data-example="<script>">hello</div>
</template>

<script setup lang="ts">
const html = "<div>not a tag for SFC parser</div>"
import Foo from "./Foo.vue"
</script>
`,
      "src/Foo.vue": "<template><div>Foo</div></template>\n",
    });

    try {
      const result = await analyze("src/main.ts", { cwd: root });

      expect(new Set(result.graph.nodes.keys())).toEqual(
        new Set(["src/main.ts", "src/Component.vue", "src/Foo.vue"]),
      );
      expectEdge(result, {
        from: "src/Component.vue",
        specifier: "./Foo.vue",
        kind: "import",
        to: "src/Foo.vue",
        status: "internal",
      });
      expect(result.warnings).toEqual([]);
    } finally {
      await removeFixture(root);
    }
  });

  test("ignores comments and template markup while parsing script language aliases", async () => {
    const root = await createFixture({
      "src/Component.vue": `<!-- <script>import CommentLeak from "./CommentLeak.vue";</script> -->
<template>
  <template v-if="ready">
    <div title='greater > than' />
  </template>
  <script>import TemplateLeak from "./TemplateLeak.vue";</script>
</template>
<script lang='typescript'>
import type { Message } from "./types.ts";
const message: Message = { text: "setup" };
require(runtimeModule);
</script>
<script setup lang=tsx>
import Child from "./Child.vue";
const view = <Child />;
import(componentName);
</script>
`,
      "src/types.ts": "export interface Message { text: string; }\n",
      "src/Child.vue": "<template><span>Child</span></template>\n",
    });

    try {
      const result = await analyze("src/Component.vue", { cwd: root });
      const componentEdges = result.graph.edges.filter((edge) => edge.from === "src/Component.vue");

      expect(componentEdges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            specifier: "./types.ts",
            kind: "import",
            typeOnly: true,
            status: "internal",
          }),
          expect.objectContaining({
            specifier: "./Child.vue",
            kind: "import",
            status: "internal",
          }),
        ]),
      );
      expect(componentEdges).toHaveLength(2);
      expect(result.warnings.map((warning) => warning.message)).toEqual([
        "dynamic import uses a non-static module specifier",
        "require uses a non-static module specifier",
      ]);
    } finally {
      await removeFixture(root);
    }
  });
});
