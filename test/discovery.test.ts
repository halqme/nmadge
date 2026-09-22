import { mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { analyze } from "../src/analyzer/analyze.ts";
import { createFixture, removeFixture, writeFixtureFiles } from "./fixtures.ts";

test("excludes .git and node_modules, deduplicates inputs, and does not follow directory symlinks", async () => {
  const outside = await mkdtemp(join(tmpdir(), "oxdg-linked-"));
  const root = await createFixture({
    "src/entry.ts": "export const entry = true;\n",
    "regular.ts": "export const regular = true;\n",
    ".git/ignored.ts": "export const ignored = true;\n",
    "node_modules/pkg/ignored.ts": "export const ignored = true;\n",
  });
  await writeFixtureFiles(outside, {
    "outside.ts": "export const outside = true;\n",
  });
  await symlink(outside, join(root, "linked-directory"));

  try {
    const withoutNpm = await analyze(".", { cwd: root });
    expect([...withoutNpm.graph.nodes.keys()]).toEqual(["regular.ts", "src/entry.ts"]);

    const withNpm = await analyze(".", { cwd: root, includeNpm: true });
    expect([...withNpm.graph.nodes.keys()]).toEqual([
      "node_modules/pkg/ignored.ts",
      "regular.ts",
      "src/entry.ts",
    ]);
    expect([...withNpm.graph.nodes.keys()].some((id) => id.startsWith(".git/"))).toBe(false);
    expect([...withNpm.graph.nodes.keys()].some((id) => id.startsWith("linked-directory/"))).toBe(
      false,
    );

    const duplicatedInputs = await analyze(["src", "src/entry.ts"], { cwd: root });
    expect([...duplicatedInputs.graph.nodes.keys()]).toEqual(["src/entry.ts"]);
  } finally {
    await removeFixture(root);
    await removeFixture(outside);
  }
});
