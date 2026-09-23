import { execFile as execFileCallback } from "node:child_process";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const packageJson = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
const maxUnpackedSizeBytes = 500 * 1024;

async function run(command, args, cwd) {
  try {
    return await execFile(command, args, { cwd, maxBuffer: 10 * 1024 * 1024 });
  } catch (error) {
    const detail = [error.stdout, error.stderr].filter(Boolean).join("\n");
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `:\n${detail}` : ""}`, {
      cause: error,
    });
  }
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parsePackResult(stdout) {
  const jsonStart = stdout.lastIndexOf("\n[");
  const start = jsonStart >= 0 ? jsonStart + 1 : stdout.indexOf("[");
  const results = JSON.parse(stdout.slice(start).trim());
  if (!Array.isArray(results) || !results[0]) {
    throw new Error("npm pack did not return a package result");
  }
  return results[0];
}

async function directorySize(directory) {
  let size = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      size += await directorySize(path);
    } else {
      size += (await lstat(path)).size;
    }
  }
  return size;
}

function formatBytes(bytes) {
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

function makeSummary(result) {
  return [
    "## Package footprint",
    "",
    `Measured \`${result.package}@${result.version}\` from the built package. The unpacked-size limit is ${formatBytes(result.maxUnpackedSizeBytes)}.`,
    "",
    "| Metric | Value |",
    "| --- | ---: |",
    `| Packed package | ${formatBytes(result.packedSizeBytes)} |`,
    `| Unpacked package | ${formatBytes(result.unpackedSizeBytes)} |`,
    `| Installed node_modules | ${formatBytes(result.nodeModulesSizeBytes)} |`,
    "",
  ].join("\n");
}

export async function runPackageFootprint() {
  const outputDirectoryOption = optionValue("--output");
  const reportOption = optionValue("--report");
  const summaryOption = optionValue("--summary");
  const outputDirectory = outputDirectoryOption ? resolve(outputDirectoryOption) : undefined;
  const reportPath = reportOption ? resolve(reportOption) : undefined;
  const summaryPath = summaryOption ? resolve(summaryOption) : process.env.GITHUB_STEP_SUMMARY;
  const temporaryRoot = await mkdtemp(join(tmpdir(), "oxdg-package-footprint-"));

  try {
    const packDirectory = join(temporaryRoot, "pack");
    await mkdir(packDirectory);
    const { stdout: packOutput } = await run(
      npm,
      ["pack", "--json", "--pack-destination", packDirectory],
      projectRoot,
    );
    const packResult = parsePackResult(packOutput);
    if (typeof packResult.unpackedSize !== "number") {
      throw new Error("npm pack did not report an unpacked package size");
    }
    if (packResult.unpackedSize > maxUnpackedSizeBytes) {
      throw new Error(
        `unpacked package size ${packResult.unpackedSize} bytes exceeds the ${maxUnpackedSizeBytes}-byte limit`,
      );
    }

    const packedPaths = packResult.files.map(({ path }) => path).sort();
    const unexpectedPaths = packedPaths.filter(
      (path) =>
        path !== "LICENSE" &&
        path !== "README.md" &&
        path !== "package.json" &&
        !path.startsWith("dist/"),
    );
    if (unexpectedPaths.length > 0) {
      throw new Error(`unexpected files in package: ${unexpectedPaths.join(", ")}`);
    }
    for (const requiredPath of [
      "LICENSE",
      "README.md",
      "package.json",
      "dist/index.js",
      "dist/index.d.ts",
      "dist/cli/main.js",
    ]) {
      if (!packedPaths.includes(requiredPath)) {
        throw new Error(`packed package is missing ${requiredPath}`);
      }
    }

    const tarball = join(packDirectory, packResult.filename);
    const consumer = join(temporaryRoot, "consumer");
    await mkdir(join(consumer, "src"), { recursive: true });
    await writeFile(
      join(consumer, "package.json"),
      JSON.stringify({ name: "oxdg-package-footprint", private: true, type: "module" }),
      "utf8",
    );
    await writeFile(join(consumer, "src", "a.ts"), 'import "./b.js";\n', "utf8");
    await writeFile(join(consumer, "src", "b.ts"), 'import "./a.js";\n', "utf8");

    await run(
      npm,
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--no-package-lock",
        "--no-save",
        tarball,
      ],
      consumer,
    );
    const installedCli = await readFile(
      join(consumer, "node_modules", "oxdg", "dist", "cli", "main.js"),
      "utf8",
    );
    if (!installedCli.startsWith("#!/usr/bin/env node\n")) {
      throw new Error("packed CLI is missing its executable shebang");
    }

    const { stdout: versionOutput } = await run(
      "npx",
      ["--no-install", "oxdg", "--version"],
      consumer,
    );
    if (versionOutput.trim() !== packageJson.version) {
      throw new Error(
        `packed CLI version ${JSON.stringify(versionOutput.trim())} does not match package.json ${JSON.stringify(packageJson.version)}`,
      );
    }
    await run("npx", ["--no-install", "oxdg", "./src", "--circular"], consumer);
    const { stdout: jsonOutput } = await run(
      "npx",
      ["--no-install", "oxdg", "./src", "--json"],
      consumer,
    );
    const jsonGraph = JSON.parse(jsonOutput);
    if (!Array.isArray(jsonGraph.modules) || !Array.isArray(jsonGraph.dependencies)) {
      throw new Error("packed CLI produced an invalid JSON graph");
    }
    await run("npx", ["--no-install", "oxdg", "./src/a.ts", "--image", "graph.svg"], consumer);
    await run(
      "bunx",
      ["--no-install", "oxdg", "./src/a.ts", "--image", "bunx-graph.svg"],
      consumer,
    );
    const svg = await readFile(join(consumer, "graph.svg"), "utf8");
    const bunxSvg = await readFile(join(consumer, "bunx-graph.svg"), "utf8");
    if (
      !svg.startsWith("<svg") ||
      !svg.includes("<marker") ||
      !bunxSvg.startsWith("<svg") ||
      !bunxSvg.includes("<marker")
    ) {
      throw new Error("packed CLI did not generate standalone SVG output");
    }

    const result = {
      package: packageJson.name,
      version: packageJson.version,
      tarballFilename: packResult.filename,
      packedSizeBytes: (await lstat(tarball)).size,
      unpackedSizeBytes: packResult.unpackedSize,
      nodeModulesSizeBytes: await directorySize(join(consumer, "node_modules")),
      maxUnpackedSizeBytes,
      fileCount: packedPaths.length,
      measuredAt: new Date().toISOString(),
    };

    if (outputDirectory) {
      await mkdir(outputDirectory, { recursive: true });
      await copyFile(tarball, join(outputDirectory, packResult.filename));
    }
    if (reportPath) {
      await mkdir(dirname(reportPath), { recursive: true });
      await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    }
    if (summaryPath) {
      await mkdir(dirname(summaryPath), { recursive: true });
      const { appendFile } = await import("node:fs/promises");
      await appendFile(summaryPath, makeSummary(result), "utf8");
    }

    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runPackageFootprint();
}
