import { execFileSync, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "bun:test";

const runnerScript = join(import.meta.dir, "../../scripts/benchmark-runner.mjs");
async function writeExecutable(path: string, source: string) {
  await writeFile(path, `#!/usr/bin/env node\n${source}`, { mode: 0o755 });
  await chmod(path, 0o755);
}

function initializeCorpus(directory: string, paths: string[]): string {
  execFileSync("git", ["init", "-q", directory]);
  execFileSync("git", ["-C", directory, "config", "user.email", "test@example.com"]);
  execFileSync("git", ["-C", directory, "config", "user.name", "Benchmark Test"]);
  execFileSync("git", ["-C", directory, "add", ...paths]);
  execFileSync("git", [
    "-C",
    directory,
    "-c",
    "commit.gpgSign=false",
    "commit",
    "--no-gpg-sign",
    "-qm",
    "test corpus",
  ]);
  return execFileSync("git", ["-C", directory, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

async function writeOxdgConsumer(workspace: string, key: string, version: string) {
  const packageDirectory = join(workspace, "consumers", key, "node_modules", "oxdg");
  await mkdir(join(packageDirectory, "dist", "cli"), { recursive: true });
  await writeFile(
    join(packageDirectory, "package.json"),
    JSON.stringify({ name: "oxdg", version }),
  );
  await writeFile(join(packageDirectory, "dist", "cli", "main.js"), "#!/usr/bin/env node\n");
}

test("records released and main revisions against both benchmark corpora", async () => {
  const root = await mkdtemp(join(tmpdir(), "oxdg-benchmark-runner-"));
  const hono = join(root, "hono");
  const webpack = join(root, "webpack");
  const workspace = join(root, "workspace");
  const fakeBin = join(root, "bin");
  const output = join(root, "output");
  const mainFootprintPath = join(root, "main-footprint.json");
  const releaseFootprintPath = join(root, "release-footprint.json");

  try {
    await mkdir(join(hono, "src", "nested"), { recursive: true });
    await mkdir(join(webpack, "lib", "nested"), { recursive: true });
    await mkdir(fakeBin);

    await writeOxdgConsumer(workspace, "release", "0.3.0");
    await writeOxdgConsumer(workspace, "main", "0.4.0");

    for (const [tool, version] of [
      ["madge", "8.0.0"],
      ["dpdm", "4.3.0"],
    ] as const) {
      await mkdir(join(workspace, "consumers", tool, "node_modules", tool), { recursive: true });
      await writeFile(
        join(workspace, "consumers", tool, "node_modules", tool, "package.json"),
        JSON.stringify({ name: tool, version }),
      );
      await mkdir(join(workspace, "consumers", tool, "node_modules", ".bin"), { recursive: true });
    }

    await writeFile(join(hono, "src", "index.ts"), "export {};\n");
    await writeFile(join(hono, "src", "entry.jsx"), "export {};\n");
    await writeFile(join(hono, "src", "nested", "more.cts"), "export {};\n");
    await writeFile(join(hono, "src", "ignored.json"), "{}\n");

    await writeFile(
      join(webpack, "lib", "index.js"),
      'module.exports = require("./nested/more");\n',
    );
    await writeFile(join(webpack, "lib", "nested", "more.js"), "module.exports = {};\n");
    await writeFile(join(webpack, "lib", "ignored.json"), "{}\n");

    const mainFootprint = {
      package: "oxdg",
      version: "0.4.0",
      tarballFilename: "oxdg-0.4.0.tgz",
      packedSizeBytes: 42000,
      unpackedSizeBytes: 110000,
      nodeModulesSizeBytes: 2100000,
    };
    const releaseFootprint = {
      package: "oxdg",
      version: "0.3.0",
      spec: "oxdg@latest",
      tarballFilename: "oxdg-0.3.0.tgz",
      packedSizeBytes: 40000,
      unpackedSizeBytes: 100000,
      nodeModulesSizeBytes: 2000000,
    };
    await writeFile(mainFootprintPath, JSON.stringify(mainFootprint));
    await writeFile(releaseFootprintPath, JSON.stringify(releaseFootprint));

    const honoCommit = initializeCorpus(hono, ["src"]);
    const webpackCommit = initializeCorpus(webpack, ["lib"]);

    await writeExecutable(
      join(fakeBin, "hyperfine"),
      `const fs = require("node:fs");\nconst args = process.argv.slice(2);\nif (args[0] === "--version") { console.log("hyperfine 1.19.0"); process.exit(0); }\nconst index = args.indexOf("--export-json");\nconst commands = args.slice(index + 2);\nfs.writeFileSync(args[index + 1], JSON.stringify({ results: commands.map((command, i) => ({ command, mean: 0.4 + i * 0.1, stddev: 0.01, median: 0.49, min: 0.38, max: 0.72 })) }));\n`,
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
        "--webpack-dir",
        webpack,
        "--workspace",
        workspace,
        "--main-package-footprint",
        mainFootprintPath,
        "--release-package-footprint",
        releaseFootprintPath,
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
          WEBPACK_COMMIT: webpackCommit,
          WEBPACK_REPOSITORY: "https://github.com/webpack/webpack.git",
          RUNNER_LABEL: "ubuntu-latest",
          NODE_VERSION: "24.x",
          BUN_VERSION: "1.4.2",
          HYPERFINE_VERSION: "1.19.0",
        },
      },
    );
    if (result.status !== 0) throw new Error(`${result.stderr}\n${result.stdout}`);

    const metadata = JSON.parse(await readFile(join(output, "benchmark-metadata.json"), "utf8"));
    expect(metadata.revisions.release).toMatchObject({
      source: "npm",
      version: "0.3.0",
      packageFootprint: releaseFootprint,
    });
    expect(metadata.revisions.main).toMatchObject({
      source: "git",
      version: "0.4.0",
      packageFootprint: mainFootprint,
    });
    expect(metadata.revisions.main.gitCommit).toMatch(/^[0-9a-f]{40}$/);

    expect(metadata.corpora.hono.workloads.directory.files).toBe(3);
    expect(metadata.corpora.webpack.workloads.directory.files).toBe(2);
    expect(metadata.corpora.hono.workloads.directory.commands.release).toContain(
      'node "$OXDG_RELEASE_CLI"',
    );
    expect(metadata.corpora.hono.workloads.directory.commands.main).toContain(
      'node "$OXDG_MAIN_CLI"',
    );
    expect(metadata.benchmark).toEqual({ warmup: 8, runs: 20 });

    for (const name of [
      "benchmark-hono-directory.json",
      "benchmark-hono-entrypoint.json",
      "benchmark-webpack-directory.json",
      "benchmark-webpack-entrypoint.json",
    ]) {
      expect(JSON.parse(await readFile(join(output, name), "utf8")).results).toHaveLength(4);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
