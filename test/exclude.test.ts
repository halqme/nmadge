import { join } from "node:path";
import { expect, test } from "bun:test";
import { analyze } from "../src/analyzer/analyze.ts";
import type { ExcludePattern } from "../src/types.ts";
import { createFixture, removeFixture } from "./fixtures.ts";

const modules = [
  "generated.ts",
  "not-generated.ts",
  "src/generated.ts",
  "nested/src/generated.ts",
  "generated/keep.ts",
  "generated/drop.ts",
  "src/generated/drop.ts",
  "src/a.test.ts",
  "src/keep.test.ts",
  "src/!literal.ts",
  "src/#literal.ts",
];

const cases: { name: string; patterns: ExcludePattern[]; excluded: string[] }[] = [
  {
    name: "basename boundaries at any depth",
    patterns: ["generated.ts"],
    excluded: ["generated.ts", "src/generated.ts", "nested/src/generated.ts"],
  },
  {
    name: "root anchoring",
    patterns: ["/generated.ts"],
    excluded: ["generated.ts"],
  },
  {
    name: "paths containing a slash are relative to cwd",
    patterns: ["src/generated.ts"],
    excluded: ["src/generated.ts"],
  },
  {
    name: "directory patterns and excluded parents",
    patterns: ["generated/", "!generated/keep.ts"],
    excluded: ["generated/keep.ts", "generated/drop.ts", "src/generated/drop.ts"],
  },
  {
    name: "negation within an included parent",
    patterns: ["generated/*", "!generated/keep.ts"],
    excluded: ["generated/drop.ts"],
  },
  {
    name: "ordered negations",
    patterns: ["*.test.ts", "!src/keep.test.ts"],
    excluded: ["src/a.test.ts"],
  },
  {
    name: "later exclusions override negations",
    patterns: ["!src/keep.test.ts", "*.test.ts"],
    excluded: ["src/a.test.ts", "src/keep.test.ts"],
  },
  {
    name: "comments and escaped leading characters",
    patterns: ["#generated.ts", "\\!literal.ts", "\\#literal.ts"],
    excluded: ["src/!literal.ts", "src/#literal.ts"],
  },
  {
    name: "double star",
    patterns: ["**/generated.ts"],
    excluded: ["generated.ts", "src/generated.ts", "nested/src/generated.ts"],
  },
  {
    name: "literal colons without pattern-type prefixes",
    patterns: ["glob:*.test.ts", "regex:generated.ts"],
    excluded: [],
  },
];

for (const { name, patterns, excluded } of cases) {
  test(`excludes discovered and imported modules using ${name}`, async () => {
    const root = await createFixture({
      ...Object.fromEntries(modules.map((id) => [id, "export {};\n"])),
      "entry.ts": modules.map((id) => `import "./${id}";`).join("\n"),
    });
    try {
      const kept = modules.filter((id) => !excluded.includes(id));
      for (const input of [".", "entry.ts"]) {
        const result = await analyze(input, { cwd: root, exclude: patterns });
        expect([...result.graph.nodes.keys()].sort()).toEqual(["entry.ts", ...kept].sort());
        expect(result.graph.edges.map((edge) => edge.to).sort()).toEqual([...kept].sort());
        expect(result.warnings).toEqual([]);
      }
    } finally {
      await removeFixture(root);
    }
  });
}

test("does not apply exclude patterns to modules outside cwd", async () => {
  const root = await createFixture({
    "project/entry.ts": 'import "../outside.ts";\n',
    "outside.ts": "export {};\n",
  });
  try {
    const cwd = join(root, "project");
    const result = await analyze("entry.ts", { cwd, exclude: "outside.ts" });
    expect([...result.graph.nodes.keys()]).toEqual(["../outside.ts", "entry.ts"]);
    expect(result.graph.edges).toEqual([
      expect.objectContaining({ from: "entry.ts", to: "../outside.ts", status: "internal" }),
    ]);
  } finally {
    await removeFixture(root);
  }
});
