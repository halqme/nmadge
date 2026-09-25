import { mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { analyze } from "../../src/analyzer/analyze.ts";
import { createFixture, removeFixture, writeFixtureFiles } from "../fixtures.ts";

describe("source discovery", () => {
  test("keeps .git excluded when node_modules are included", async () => {
    const root = await createFixture({
      "src/entry.ts": "export const entry = true;\n",
      ".git/ignored.ts": "export const ignored = true;\n",
      "node_modules/pkg/dependency.ts": "export const dependency = true;\n",
    });

    try {
      const result = await analyze(".", { cwd: root, includeNpm: true });

      expect([...result.graph.nodes.keys()]).toEqual([
        "node_modules/pkg/dependency.ts",
        "src/entry.ts",
      ]);
    } finally {
      await removeFixture(root);
    }
  });

  test("skips node_modules by default and includes it when requested", async () => {
    const root = await createFixture({
      "src/entry.ts": "export const entry = true;\n",
      "node_modules/pkg/index.ts": "export const dependency = true;\n",
    });

    try {
      const defaults = await analyze(".", { cwd: root });
      expect([...defaults.graph.nodes.keys()]).toEqual(["src/entry.ts"]);

      const withNpm = await analyze(".", { cwd: root, includeNpm: true });
      expect([...withNpm.graph.nodes.keys()]).toEqual([
        "node_modules/pkg/index.ts",
        "src/entry.ts",
      ]);
    } finally {
      await removeFixture(root);
    }
  });

  test("deduplicates overlapping input paths", async () => {
    const root = await createFixture({
      "src/entry.ts": "export const entry = true;\n",
    });

    try {
      const result = await analyze(["src", "src/entry.ts"], { cwd: root });

      expect([...result.graph.nodes.keys()]).toEqual(["src/entry.ts"]);
    } finally {
      await removeFixture(root);
    }
  });

  test("does not follow directory symlinks", async () => {
    const outside = await mkdtemp(join(tmpdir(), "oxdg-linked-"));
    const root = await createFixture({
      "src/entry.ts": "export const entry = true;\n",
    });
    await writeFixtureFiles(outside, {
      "outside.ts": "export const outside = true;\n",
    });
    await symlink(outside, join(root, "linked-directory"));

    try {
      const result = await analyze(".", { cwd: root });

      expect([...result.graph.nodes.keys()]).toEqual(["src/entry.ts"]);
    } finally {
      await removeFixture(root);
      await removeFixture(outside);
    }
  });
});
