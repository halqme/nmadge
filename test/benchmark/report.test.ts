import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";

const reportScript = join(import.meta.dir, "../../scripts/benchmark-report.mjs");
const extensions = ["js", "jsx", "ts", "tsx", "mjs", "cjs", "mts", "cts"];

function commands(directoryInput: string, entrypointInput: string) {
  const list = extensions.join(",");
  return {
    directory: {
      release: `node "$OXDG_RELEASE_CLI" --extensions ${list} ${directoryInput}`,
      main: `node "$OXDG_MAIN_CLI" --extensions ${list} ${directoryInput}`,
      dpdm: `dpdm '${directoryInput}/**/*.{${list}}'`,
      madge: `madge --extensions ${list} ${directoryInput}`,
    },
    entrypoint: {
      release: `node "$OXDG_RELEASE_CLI" --extensions ${list} ${entrypointInput}`,
      main: `node "$OXDG_MAIN_CLI" --extensions ${list} ${entrypointInput}`,
      dpdm: `dpdm --extensions ${list} ${entrypointInput}`,
      madge: `madge --extensions ${list} ${entrypointInput}`,
    },
  };
}

function hyperfine(commands: Record<string, string>, means: Record<string, number>) {
  return {
    results: Object.entries(commands).map(([tool, command]) => {
      const mean = means[tool];
      if (mean === undefined) throw new Error(`missing synthetic timing for ${tool}`);
      return {
        command,
        mean,
        stddev: mean / 100,
        median: mean * 0.99,
        min: mean * 0.95,
        max: mean * 1.05,
      };
    }),
  };
}

const honoCommands = commands("src", "src/index.ts");
const webpackCommands = commands("lib", "lib/index.js");

function metadata() {
  return {
    runner: {
      label: "ubuntu-latest",
      imageOS: "ubuntu24",
      imageVersion: "20260901.1",
      workflowRunId: "12345",
      workflowRunAttempt: "1",
    },
    host: {
      uname: "Linux runner",
      cpu: {
        lscpu: [
          { field: "Model name:", data: "Test CPU" },
          { field: "CPU(s):", data: "2" },
        ],
      },
    },
    revisions: {
      release: {
        label: "Released v0.3.0",
        source: "npm",
        version: "0.3.0",
        packageFootprint: {
          package: "oxdg",
          version: "0.3.0",
          packedSizeBytes: 40000,
          unpackedSizeBytes: 100000,
          nodeModulesSizeBytes: 2000000,
        },
      },
      main: {
        label: "Development main",
        source: "git",
        version: "0.4.0",
        gitCommit: "abcdef1234567890abcdef1234567890abcdef12",
        packageFootprint: {
          package: "oxdg",
          version: "0.4.0",
          packedSizeBytes: 42000,
          unpackedSizeBytes: 110000,
          nodeModulesSizeBytes: 2100000,
        },
      },
    },
    tools: {
      dpdm: { version: "4.3.0" },
      madge: { version: "8.0.0" },
    },
    runtimes: {
      node: { requested: "24.x", actual: "v24.0.0" },
      bun: { requested: "1.4.2", actual: "1.4.2" },
      npm: "11.0.0",
      hyperfine: { requested: "1.19.0", actual: "hyperfine 1.19.0" },
    },
    benchmark: { warmup: 8, runs: 20 },
    corpora: {
      hono: {
        name: "honojs/hono",
        profile: "ESM / TypeScript",
        repository: "https://github.com/honojs/hono.git",
        commit: "098e11912ab244c5c33931de007f04dc8e3c2929",
        workloads: {
          directory: { input: "src", extensions, files: 311, commands: honoCommands.directory },
          entrypoint: { input: "src/index.ts", extensions, commands: honoCommands.entrypoint },
        },
      },
      webpack: {
        name: "webpack/webpack",
        profile: "CommonJS / JavaScript",
        repository: "https://github.com/webpack/webpack.git",
        commit: "e9e02fb312a904c04e151ebd08aaa03364a31513",
        workloads: {
          directory: { input: "lib", extensions, files: 776, commands: webpackCommands.directory },
          entrypoint: { input: "lib/index.js", extensions, commands: webpackCommands.entrypoint },
        },
      },
    },
  };
}

async function writeInput(directory: string, name: string, value: unknown) {
  await writeFile(join(directory, name), `${JSON.stringify(value)}\n`);
}

function generate(directory: string, output: string) {
  return spawnSync(
    "node",
    [
      reportScript,
      "--hono-directory",
      join(directory, "hono-directory.json"),
      "--hono-entrypoint",
      join(directory, "hono-entrypoint.json"),
      "--webpack-directory",
      join(directory, "webpack-directory.json"),
      "--webpack-entrypoint",
      join(directory, "webpack-entrypoint.json"),
      "--metadata",
      join(directory, "metadata.json"),
      "--output",
      output,
    ],
    { encoding: "utf8" },
  );
}

async function writeValidInputs(inputs: string) {
  await writeInput(
    inputs,
    "hono-directory.json",
    hyperfine(honoCommands.directory, { release: 0.5, main: 0.25, dpdm: 1, madge: 2 }),
  );
  await writeInput(
    inputs,
    "hono-entrypoint.json",
    hyperfine(honoCommands.entrypoint, { release: 0.2, main: 0.1, dpdm: 0.4, madge: 0.8 }),
  );
  await writeInput(
    inputs,
    "webpack-directory.json",
    hyperfine(webpackCommands.directory, { release: 1, main: 0.5, dpdm: 2, madge: 4 }),
  );
  await writeInput(
    inputs,
    "webpack-entrypoint.json",
    hyperfine(webpackCommands.entrypoint, { release: 0.8, main: 0.4, dpdm: 1.6, madge: 3.2 }),
  );
  await writeInput(inputs, "metadata.json", metadata());
}

test("generates stable and development benchmark reports", async () => {
  const root = await mkdtemp(join(tmpdir(), "oxdg-benchmark-report-"));
  const inputs = join(root, "inputs");
  const output = join(root, "report");
  await mkdir(inputs);
  try {
    await writeValidInputs(inputs);
    const result = generate(inputs, output);
    if (result.status !== 0) throw new Error(`${result.stderr}\n${result.stdout}`);

    const release = JSON.parse(await readFile(join(output, "release.json"), "utf8"));
    const main = JSON.parse(await readFile(join(output, "main.json"), "utf8"));
    const combined = JSON.parse(await readFile(join(output, "latest.json"), "utf8"));

    expect(release.revision).toMatchObject({ key: "release", source: "npm", version: "0.3.0" });
    expect(release.corpora.hono.workloads.directory.results.oxdg.meanMs).toBe(500);
    expect(release.corpora.webpack.workloads.directory.results.oxdg.meanMs).toBe(1000);
    expect(release.corpora.hono.workloads.directory.relativePerformance.madge).toMatchObject({
      ratioToOxdg: 4,
      label: "4.00× slower",
    });

    expect(main.revision).toMatchObject({
      key: "main",
      source: "git",
      gitCommit: "abcdef1234567890abcdef1234567890abcdef12",
    });
    expect(main.corpora.hono.workloads.directory.results.oxdg.meanMs).toBe(250);
    expect(main.corpora.webpack.workloads.directory.results.oxdg.meanMs).toBe(500);

    expect(combined.schemaVersion).toBe(2);
    expect(combined.sinceRelease.hono.directory).toMatchObject({
      releaseMs: 500,
      mainMs: 250,
      deltaPercent: -50,
      speedup: 2,
    });

    const summary = await readFile(join(output, "summary.md"), "utf8");
    expect(summary).toContain("Released — oxdg v0.3.0");
    expect(summary).toContain("Development — main @ abcdef123456");
    expect(summary).toContain("Since latest release");
    expect(summary).toContain("-50.0%");

    const releaseBadge = JSON.parse(await readFile(join(output, "badges/runtime.json"), "utf8"));
    const mainBadge = JSON.parse(await readFile(join(output, "badges/main-runtime.json"), "utf8"));
    expect(releaseBadge).toMatchObject({
      label: "Hono · oxdg v0.3.0",
      message: "500 ms",
    });
    expect(mainBadge).toMatchObject({
      label: "Hono · oxdg main",
      message: "250 ms",
    });

    const page = await readFile(join(output, "index.html"), "utf8");
    expect(page).toContain("Released v0.3.0");
    expect(page).toContain("Development main");
    expect(page).toContain("Since latest release");
    expect(page).toContain("release.json");
    expect(page).toContain("main.json");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects incomplete revision results", async () => {
  const root = await mkdtemp(join(tmpdir(), "oxdg-benchmark-report-invalid-"));
  const inputs = join(root, "inputs");
  const output = join(root, "report");
  await mkdir(inputs);
  try {
    await writeValidInputs(inputs);
    const invalid = hyperfine(webpackCommands.directory, {
      release: 1,
      main: 0.5,
      dpdm: 2,
      madge: 4,
    });
    invalid.results = invalid.results.filter(
      (item) => item.command !== webpackCommands.directory.main,
    );
    await writeInput(inputs, "webpack-directory.json", invalid);

    const result = generate(inputs, output);
    expect(result.status).not.toBe(0);
    expect(await Bun.file(output).exists()).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
