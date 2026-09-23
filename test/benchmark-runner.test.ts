import { execFileSync, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "bun:test";

const runnerScript = join(import.meta.dir, "../scripts/benchmark-runner.mjs");
const extensions = ["js", "jsx", "ts", "tsx", "mjs", "cjs", "mts", "cts"];

async function writeExecutable(path: string, source: string) {
  await writeFile(path, `#!/usr/bin/env node\n${source}`, { mode: 0o755 });
  await chmod(path, 0o755);
}

test("records equivalent workloads, source-file count, commands, and runner metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "oxdg-benchmark-runner-"));
  const hono = join(root, "hono");
  const workspace = join(root, "workspace");
  const fakeBin = join(root, "bin");
  const output = join(root, "output");
  const footprintPath = join(root, "package-footprint.json");
  try {
    await mkdir(join(hono, "src", "nested"), { recursive: true });
    await mkdir(fakeBin);
    for (const tool of ["oxdg", "madge", "dpdm"]) {
      const packageName = tool === "oxdg" ? "oxdg" : tool;
      await mkdir(join(workspace, "consumers", tool, "node_modules", packageName), {
        recursive: true,
      });
      await writeFile(
        join(workspace, "consumers", tool, "node_modules", packageName, "package.json"),
        JSON.stringify({
          version: tool === "oxdg" ? "0.1.0" : tool === "madge" ? "8.0.0" : "4.3.0",
        }),
      );
      await mkdir(join(workspace, "consumers", tool, "node_modules", ".bin"), { recursive: true });
    }
    await writeFile(join(hono, "src", "index.ts"), "export {};\n");
    await writeFile(join(hono, "src", "entry.jsx"), "export {};\n");
    await writeFile(join(hono, "src", "nested", "more.cts"), "export {};\n");
    await writeFile(join(hono, "src", "ignored.json"), "{}\n");
    await writeFile(
      footprintPath,
      JSON.stringify({
        package: "oxdg",
        version: "0.1.0",
        tarballFilename: "oxdg-0.1.0.tgz",
        packedSizeBytes: 40000,
        unpackedSizeBytes: 100000,
        nodeModulesSizeBytes: 2000000,
      }),
    );

    execFileSync("git", ["init", "-q", hono]);
    execFileSync("git", ["-C", hono, "config", "user.email", "test@example.com"]);
    execFileSync("git", ["-C", hono, "config", "user.name", "Benchmark Test"]);
    execFileSync("git", ["-C", hono, "add", "src"]);
    execFileSync("git", [
      "-C",
      hono,
      "-c",
      "commit.gpgSign=false",
      "commit",
      "--no-gpg-sign",
      "-qm",
      "test corpus",
    ]);
    const honoCommit = execFileSync("git", ["-C", hono, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();

    await writeExecutable(
      join(fakeBin, "hyperfine"),
      `const fs = require("node:fs");\nconst args = process.argv.slice(2);\nif (args[0] === "--version") { console.log("hyperfine 1.19.0"); process.exit(0); }\nconst index = args.indexOf("--export-json");\nconst commands = args.slice(index + 2);\nfs.writeFileSync(args[index + 1], JSON.stringify({ results: commands.map((command) => ({ command, mean: 0.5, stddev: 0.01, median: 0.49, min: 0.48, max: 0.52 })) }));\n`,
    );
    await writeExecutable(
      join(fakeBin, "lscpu"),
      'console.log(JSON.stringify({ lscpu: [{ field: "CPU(s):", data: "2" }] }));\n',
    );
    await writeExecutable(join(fakeBin, "bun"), 'console.log("1.4.2");\n');

    const result = spawnSync(
      "node",
      [
        runnerScript,
        "--hono-dir",
        hono,
        "--workspace",
        workspace,
        "--package-footprint",
        footprintPath,
        "--output",
        output,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${fakeBin}${delimiter}${process.env["PATH"]}`,
          HONO_COMMIT: honoCommit,
          HONO_REPOSITORY: "https://github.com/honojs/hono.git",
          RUNNER_LABEL: "ubuntu-latest",
          NODE_VERSION: "24.x",
          BUN_VERSION: "1.4.2",
          HYPERFINE_VERSION: "1.19.0",
        },
      },
    );
    if (result.status !== 0) throw new Error(`${result.stderr}\n${result.stdout}`);

    const metadata = JSON.parse(await readFile(join(output, "benchmark-metadata.json"), "utf8"));
    expect(metadata.corpus.commit).toBe(honoCommit);
    expect(metadata.workloads.directory.files).toBe(3);
    expect(metadata.workloads.directory.extensions).toEqual(extensions);
    expect(metadata.workloads.directory.commands).toEqual({
      madge: "madge --extensions js,jsx,ts,tsx,mjs,cjs,mts,cts src",
      oxdg: "oxdg --extensions js,jsx,ts,tsx,mjs,cjs,mts,cts src",
      dpdm: "dpdm 'src/**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}'",
    });
    expect(metadata.workloads.entrypoint.extensions).toEqual(extensions);
    expect(metadata.workloads.entrypoint.commands).toEqual({
      madge: "madge --extensions js,jsx,ts,tsx,mjs,cjs,mts,cts src/index.ts",
      oxdg: "oxdg --extensions js,jsx,ts,tsx,mjs,cjs,mts,cts src/index.ts",
      dpdm: "dpdm --extensions js,jsx,ts,tsx,mjs,cjs,mts,cts src/index.ts",
    });
    expect(metadata.benchmark).toEqual({ warmup: 8, runs: 20 });
    expect(metadata.runner.label).toBe("ubuntu-latest");
    expect(metadata.packageFootprint.tarballFilename).toBe("oxdg-0.1.0.tgz");
    expect(
      JSON.parse(await readFile(join(output, "benchmark-directory.json"), "utf8")).results,
    ).toHaveLength(3);
    expect(
      JSON.parse(await readFile(join(output, "benchmark-entrypoint.json"), "utf8")).results,
    ).toHaveLength(3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
