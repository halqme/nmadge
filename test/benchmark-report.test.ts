import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";

const reportScript = join(import.meta.dir, "../scripts/benchmark-report.mjs");
const directoryCommands = {
  madge: "madge --extensions js,jsx,ts,tsx,mjs,cjs,mts,cts src",
  oxdg: "oxdg --extensions js,jsx,ts,tsx,mjs,cjs,mts,cts src",
  dpdm: "dpdm 'src/**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}'",
};
const entrypointCommands = {
  madge: "madge --extensions js,jsx,ts,tsx,mjs,cjs,mts,cts src/index.ts",
  oxdg: "oxdg --extensions js,jsx,ts,tsx,mjs,cjs,mts,cts src/index.ts",
  dpdm: "dpdm --extensions js,jsx,ts,tsx,mjs,cjs,mts,cts src/index.ts",
};

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
    corpus: {
      name: "honojs/hono",
      repository: "https://github.com/honojs/hono.git",
      commit: "098e11912ab244c5c33931de007f04dc8e3c2929",
    },
    tools: {
      oxdg: { version: "0.1.0", gitCommit: "abcdef123" },
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
      version: "0.1.0",
      packedSizeBytes: 40000,
      unpackedSizeBytes: 100000,
      nodeModulesSizeBytes: 2000000,
    },
    workloads: {
      directory: {
        input: "src",
        extensions: ["js", "jsx", "ts", "tsx", "mjs", "cjs", "mts", "cts"],
        files: 642,
        commands: directoryCommands,
      },
      entrypoint: {
        input: "src/index.ts",
        extensions: ["js", "jsx", "ts", "tsx", "mjs", "cjs", "mts", "cts"],
        commands: entrypointCommands,
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
      "--directory",
      join(directory, "directory.json"),
      "--entrypoint",
      join(directory, "entrypoint.json"),
      "--metadata",
      join(directory, "metadata.json"),
      "--output",
      output,
    ],
    { encoding: "utf8" },
  );
}

test("generates a normalized report, complete summary, and corpus-labeled badges", async () => {
  const root = await mkdtemp(join(tmpdir(), "oxdg-benchmark-report-"));
  const inputs = join(root, "inputs");
  const output = join(root, "report");
  await mkdir(inputs);
  try {
    await writeInput(
      inputs,
      "directory.json",
      hyperfine(directoryCommands, { madge: 2, oxdg: 0.5, dpdm: 1 }),
    );
    await writeInput(
      inputs,
      "entrypoint.json",
      hyperfine(entrypointCommands, { madge: 0.4, oxdg: 0.1, dpdm: 0.2 }),
    );
    await writeInput(inputs, "metadata.json", metadata());

    const result = generate(inputs, output);
    if (result.status !== 0) throw new Error(`${result.stderr}\n${result.stdout}`);

    const normalized = JSON.parse(await readFile(join(output, "latest.json"), "utf8"));
    expect(normalized.corpus.commit).toBe("098e11912ab244c5c33931de007f04dc8e3c2929");
    expect(normalized.workloads.directory.files).toBe(642);
    expect(normalized.workloads.directory.results.oxdg).toMatchObject({
      meanSeconds: 0.5,
      meanMs: 500,
      stddevMs: 5,
      medianMs: 495,
      minMs: 475,
      maxMs: 525,
    });
    expect(normalized.workloads.directory.relativePerformance.madge).toMatchObject({
      ratioToOxdg: 4,
      label: "4.00× slower",
    });
    expect(normalized.workloads.entrypoint.results.oxdg.meanMs).toBe(100);
    expect(normalized.workloads.directory.commands.dpdm).toBe(directoryCommands.dpdm);

    const summary = await readFile(join(output, "summary.md"), "utf8");
    expect(summary).toContain("Result summary: oxdg on honojs/hono");
    expect(summary).toContain("642");
    expect(summary).toContain("Stddev");
    expect(summary).toContain("madge --extensions js,jsx,ts,tsx,mjs,cjs,mts,cts src");
    expect(summary).toContain("dpdm 'src/**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}'");
    expect(summary).toContain("8 warmups, 20 measured runs");
    expect(summary).toContain(
      "| Entrypoint | `src/index.ts` | js, jsx, ts, tsx, mjs, cjs, mts, cts | — |",
    );
    expect(summary).toContain("madge --extensions js,jsx,ts,tsx,mjs,cjs,mts,cts src/index.ts");

    const runtimeBadge = JSON.parse(await readFile(join(output, "badges/runtime.json"), "utf8"));
    const entrypointBadge = JSON.parse(
      await readFile(join(output, "badges/entrypoint.json"), "utf8"),
    );
    const madgeBadge = JSON.parse(await readFile(join(output, "badges/vs-madge.json"), "utf8"));
    expect(runtimeBadge).toMatchObject({
      schemaVersion: 1,
      label: "Hono benchmark",
      message: "500 ms",
      color: "blue",
    });
    expect(entrypointBadge).toMatchObject({
      schemaVersion: 1,
      label: "Hono entrypoint",
      message: "100 ms",
      color: "blue",
    });
    expect(madgeBadge).toMatchObject({
      schemaVersion: 1,
      label: "Hono vs Madge",
      message: "4.00× faster",
      color: "blue",
    });
    const page = await readFile(join(output, "index.html"), "utf8");
    expect(page).toContain("Entrypoint analysis");
    expect(page).toContain("extensions: js, jsx, ts, tsx, mjs, cjs, mts, cts");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects incomplete hyperfine results without publishing partial report files", async () => {
  const root = await mkdtemp(join(tmpdir(), "oxdg-benchmark-report-invalid-"));
  const inputs = join(root, "inputs");
  const output = join(root, "report");
  await mkdir(inputs);
  try {
    const invalid = hyperfine(directoryCommands, { madge: 2, oxdg: 0.5, dpdm: 1 });
    delete (invalid.results[0] as Partial<(typeof invalid.results)[number]>).max;
    await writeInput(inputs, "directory.json", invalid);
    await writeInput(
      inputs,
      "entrypoint.json",
      hyperfine(entrypointCommands, { madge: 0.4, oxdg: 0.1, dpdm: 0.2 }),
    );
    await writeInput(inputs, "metadata.json", metadata());

    const result = generate(inputs, output);
    expect(result.status).not.toBe(0);
    expect(await Bun.file(output).exists()).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
