import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "bun:test";
import { createFixture, removeFixture } from "../fixtures.ts";

function cliPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../../src/cli/main.ts");
}

function runCli(...args: string[]): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  return runCliIn(process.cwd(), ...args);
}

function runCliIn(
  cwd: string,
  ...args: string[]
): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(process.execPath, [cliPath(), ...args], {
    cwd,
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

test("applies repeated gitignore exclusions in order relative to --cwd", async () => {
  const root = await createFixture({
    "src/entry.ts": 'import "./keep.test.ts";\nimport "./drop.test.ts";\n',
    "src/keep.test.ts": "export {};\n",
    "src/drop.test.ts": "export {};\n",
  });
  try {
    const result = runCli(
      "src",
      "--cwd",
      root,
      "--json",
      "--exclude",
      "*.test.ts",
      "--exclude",
      "!src/keep.test.ts",
    );
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      modules: [{ id: "src/entry.ts" }, { id: "src/keep.test.ts" }],
      dependencies: [{ from: "src/entry.ts", to: "src/keep.test.ts", status: "internal" }],
    });
  } finally {
    await removeFixture(root);
  }
});

test("runs help and version without an input path", () => {
  const help = runCli("--help");
  expect(help.status).toBe(0);
  expect(help.stderr).toBe("");
  expect(help.stdout).toContain("Usage: oxdg <path...> [options]");
  expect(help.stdout).toContain("-c, --circular");
  expect(help.stdout).toContain("JSON query results");
  expect(help.stdout).toContain("Mermaid/SVG only");

  const version = runCli("--version");
  expect(version.status).toBe(0);
  expect(version.stderr).toBe("");
  expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
});

test("uses exit code 2 for usage errors and 1 for analysis failures", () => {
  expect(runCli().status).toBe(2);
  expect(runCli("--unknown-option").status).toBe(2);
  expect(runCli("missing-input.ts").status).toBe(1);
});

test("runs graph queries and fail-on-circular through the CLI", async () => {
  const root = await createFixture({
    "src/a.ts": 'import "./b.js";\n',
    "src/b.ts": "export const b = true;\n",
    "src/consumer.ts": 'import "./target.js";\n',
    "src/target.ts": "export const target = true;\n",
    "src/extra.js": "export const extra = true;\n",
  });

  try {
    expect(runCliIn(root, "src", "--orphans").stdout).toBe(
      "src/a.ts\nsrc/consumer.ts\nsrc/extra.js\n",
    );
    expect(runCliIn(root, "src", "--leaves").stdout).toBe(
      "src/b.ts\nsrc/extra.js\nsrc/target.ts\n",
    );
    expect(runCliIn(root, "src", "--depends", "src/target.ts").stdout).toBe("src/consumer.ts\n");
    expect(runCliIn(root, "src", "--depends", "target.ts").stdout).toBe("src/consumer.ts\n");
    expect(runCliIn(root, "src", "--depends", "missing.ts").status).toBe(2);

    const jsonOrphans = runCliIn(root, "--json", "src", "--orphans");
    expect(jsonOrphans.status).toBe(0);
    expect(JSON.parse(jsonOrphans.stdout)).toEqual(["src/a.ts", "src/consumer.ts", "src/extra.js"]);
    const jsonLeaves = runCliIn(root, "src", "--leaves", "--json");
    expect(jsonLeaves.status).toBe(0);
    expect(JSON.parse(jsonLeaves.stdout)).toEqual(["src/b.ts", "src/extra.js", "src/target.ts"]);
    const jsonDependents = runCliIn(root, "src", "--depends", "target.ts", "--json");
    expect(jsonDependents.status).toBe(0);
    expect(JSON.parse(jsonDependents.stdout)).toEqual(["src/consumer.ts"]);

    const typeScriptOnly = JSON.parse(
      runCliIn(root, "src", "--json", "--extensions", "ts").stdout,
    ) as { modules: { id: string }[] };
    expect(typeScriptOnly.modules.map((module) => module.id)).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/consumer.ts",
      "src/target.ts",
    ]);

    const cycleRoot = await createFixture({
      "src/a.ts": 'import "./b.js";\n',
      "src/b.ts": 'import "./a.js";\n',
    });
    try {
      const failed = runCliIn(cycleRoot, "src", "--fail-on-circular");
      expect(failed.status).toBe(1);
      expect(failed.stdout).toContain("src/a.ts");

      const failModes = [
        ["--json"],
        ["--mermaid"],
        ["--d2"],
        ["--circular"],
        ["--image", join(cycleRoot, "graph.svg")],
      ];
      for (const mode of failModes) {
        expect(runCliIn(cycleRoot, "src", ...mode, "--fail-on-circular").status).toBe(1);
      }

      const passed = runCliIn(cycleRoot, "src", "--fail-on-circular", "--exclude", "b.ts");
      expect(passed.status).toBe(0);
    } finally {
      await removeFixture(cycleRoot);
    }
  } finally {
    await removeFixture(root);
  }
});
