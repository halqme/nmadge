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
      madge: `madge --extensions ${list} ${directoryInput}`,
      oxdg: `oxdg --extensions ${list} ${directoryInput}`,
      dpdm: `dpdm '${directoryInput}/**/*.{${list}}'`,
    },
    entrypoint: {
      madge: `madge --extensions ${list} ${entrypointInput}`,
      oxdg: `oxdg --extensions ${list} ${entrypointInput}`,
      dpdm: `dpdm --extensions ${list} ${entrypointInput}`,
    },
  };
}

function hyperfine(commands: Record<string, string>, meanSeconds: Record<string, number>) {
  return {
    results: Object.entries(commands).map(([tool, command]) => {
      const mean = meanSeconds[tool];
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
      cpu: { lscpu: [{ field: "Model name:", data: "Test CPU" }, { field: "CPU(s):", data: "2" }] },
    },
    tools: {
      oxdg: { version: "0.3.0", gitCommit: "abcdef123" },
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
    packageFootprint: {
      package: "oxdg",
      version: "0.3.0",
      packedSizeBytes: 40000,
      unpackedSizeBytes: 100000,
      nodeModulesSizeBytes: 2000000,
    },
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
      "--hono-directory", join(directory, "hono-directory.json"),
      "--hono-entrypoint", join(directory, "hono-entrypoint.json"),
      "--webpack-directory", join(directory, "webpack-directory.json"),
      "--webpack-entrypoint", join(directory, "webpack-entrypoint.json"),
      "--metadata", join(directory, "metadata.json"),
      "--output", output,
    ],
    { encoding: "utf8" },
  );
}

async function writeValidInputs(inputs: string) {
  await writeInput(inputs, "hono-directory.json", hyperfine(honoCommands.directory, { madge: 2, oxdg: 0.5, dpdm: 1 }));
  await writeInput(inputs, "hono-entrypoint.json", hyperfine(honoCommands.entrypoint, { madge: 0.4, oxdg: 0.1, dpdm: 0.2 }));
  await writeInput(inputs, "webpack-directory.json", hyperfine(webpackCommands.directory, { madge: 4, oxdg: 1, dpdm: 2 }));
  await writeInput(inputs, "webpack-entrypoint.json", hyperfine(webpackCommands.entrypoint, { madge: 0.8, oxdg: 0.2, dpdm: 0.4 }));
  await writeInput(inputs, "metadata.json", metadata());
}

test("generates a normalized dual-corpus report and Pages output", async () => {
  const root = await mkdtemp(join(tmpdir(), "oxdg-benchmark-report-"));
  const inputs = join(root, "inputs");
  const output = join(root, "report");
  await mkdir(inputs);
  try {
    await writeValidInputs(inputs);
    const result = generate(inputs, output);
    if (result.status !== 0) throw new Error(`${result.stderr}\n${result.stdout}`);

    const normalized = JSON.parse(await readFile(join(output, "latest.json"), "utf8"));
    expect(normalized.corpora.hono.profile).toBe("ESM / TypeScript");
    expect(normalized.corpora.hono.workloads.directory.files).toBe(311);
    expect(normalized.corpora.hono.workloads.directory.results.oxdg.meanMs).toBe(500);
    expect(normalized.corpora.webpack.profile).toBe("CommonJS / JavaScript");
    expect(normalized.corpora.webpack.workloads.directory.files).toBe(776);
    expect(normalized.corpora.webpack.workloads.directory.results.oxdg.meanMs).toBe(1000);
    expect(normalized.corpora.webpack.workloads.directory.relativePerformance.madge).toMatchObject({
      ratioToOxdg: 4,
      label: "4.00× slower",
    });

    const summary = await readFile(join(output, "summary.md"), "utf8");
    expect(summary).toContain("honojs/hono — ESM / TypeScript");
    expect(summary).toContain("webpack/webpack — CommonJS / JavaScript");
    expect(summary).toContain("311");
    expect(summary).toContain("776");
    expect(summary).toContain("8 warmups, 20 measured runs");

    const honoBadge = JSON.parse(await readFile(join(output, "badges/runtime.json"), "utf8"));
    const webpackBadge = JSON.parse(
      await readFile(join(output, "badges/webpack-runtime.json"), "utf8"),
    );
    expect(honoBadge).toMatchObject({ label: "Hono benchmark", message: "500 ms" });
    expect(webpackBadge).toMatchObject({ label: "Webpack benchmark", message: "1000 ms" });

    const page = await readFile(join(output, "index.html"), "utf8");
    expect(page).toContain("honojs/hono");
    expect(page).toContain("webpack/webpack");
    expect(page).toContain("ESM / TypeScript");
    expect(page).toContain("CommonJS / JavaScript");
    expect(page).toContain("Directory-wide analysis");
    expect(page).toContain("Entrypoint analysis");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects incomplete corpus results without publishing partial report files", async () => {
  const root = await mkdtemp(join(tmpdir(), "oxdg-benchmark-report-invalid-"));
  const inputs = join(root, "inputs");
  const output = join(root, "report");
  await mkdir(inputs);
  try {
    await writeValidInputs(inputs);
    const invalid = hyperfine(webpackCommands.directory, { madge: 4, oxdg: 1, dpdm: 2 });
    delete (invalid.results[0] as Partial<(typeof invalid.results)[number]>).max;
    await writeInput(inputs, "webpack-directory.json", invalid);

    const result = generate(inputs, output);
    expect(result.status).not.toBe(0);
    expect(await Bun.file(output).exists()).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
