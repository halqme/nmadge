import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const projectRoot = new URL("../", import.meta.url);
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const temporaryRoot = await mkdtemp(join(tmpdir(), "oxdg-pack-check-"));

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

try {
  const packDirectory = join(temporaryRoot, "pack");
  await mkdir(packDirectory);
  const { stdout: packOutput } = await run(
    npm,
    ["pack", "--json", "--pack-destination", packDirectory],
    projectRoot,
  );
  const packJsonStart = packOutput.lastIndexOf("\n[");
  const packResult = JSON.parse(packOutput.slice(packJsonStart >= 0 ? packJsonStart + 1 : 0))[0];
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
    JSON.stringify({ name: "oxdg-pack-check", private: true, type: "module" }),
    "utf8",
  );
  await writeFile(join(consumer, "src", "a.ts"), 'import "./b.js";\n', "utf8");
  await writeFile(join(consumer, "src", "b.ts"), 'import "./a.js";\n', "utf8");

  await run(
    npm,
    ["install", "--ignore-scripts", "--no-package-lock", "--no-save", tarball],
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
  await run("bunx", ["--no-install", "oxdg", "./src/a.ts", "--image", "bunx-graph.svg"], consumer);
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

  console.log(
    `Checked ${packResult.filename}: ${packedPaths.length} files, CLI, cycles, JSON, npx, and bunx`,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
