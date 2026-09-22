import { execFile as execFileCallback } from "node:child_process";
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const packageJson = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

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

function parsePackResult(stdout) {
  const jsonStart = stdout.lastIndexOf("\n[");
  const json = stdout.slice(jsonStart >= 0 ? jsonStart + 1 : stdout.indexOf("[")).trim();
  const results = JSON.parse(json);
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

async function packPackage({ destination, cwd, spec }) {
  await rm(destination, { force: true, recursive: true });
  await mkdir(destination, { recursive: true });
  const args = ["pack", "--json", "--pack-destination", destination];
  if (spec) {
    args.push(spec);
  }
  const { stdout } = await run(npm, args, cwd);
  const packResult = parsePackResult(stdout);
  if (typeof packResult.unpackedSize !== "number") {
    throw new Error(`npm pack did not report an unpacked size for ${spec ?? "oxdg"}`);
  }
  const tarball = join(destination, packResult.filename);
  return {
    ...packResult,
    tarball,
    tarballSize: (await lstat(tarball)).size,
  };
}

async function installPackage({ consumer, packageName, tarball }) {
  await rm(consumer, { force: true, recursive: true });
  await mkdir(consumer, { recursive: true });
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify(
      {
        name: `oxdg-benchmark-${packageName}`,
        private: true,
        type: "module",
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
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
  return directorySize(join(consumer, "node_modules"));
}

const workspaceOption = optionValue("--workspace");
const outputOption = optionValue("--output");
const workspace = resolve(workspaceOption ?? (await mkdtemp(join(tmpdir(), "oxdg-benchmark-"))));
const output = resolve(outputOption ?? join(projectRoot, "benchmark-package-sizes.json"));
await mkdir(workspace, { recursive: true });
await mkdir(join(workspace, "packs"), { recursive: true });
await mkdir(join(workspace, "consumers"), { recursive: true });
await writeFile(
  join(workspace, "package.json"),
  JSON.stringify({ name: "oxdg-benchmark-workspace", private: true }) + "\n",
  "utf8",
);

const packageDefinitions = [
  {
    key: "oxdg",
    source: "current checkout",
    cwd: projectRoot,
  },
  {
    key: "madge",
    source: "npm registry",
    spec: "madge@8.0.0",
    cwd: workspace,
  },
  {
    key: "dpdm",
    source: "npm registry",
    spec: "dpdm@4.3.0",
    cwd: workspace,
  },
];

const packages = [];
for (const definition of packageDefinitions) {
  const packed = await packPackage({
    cwd: definition.cwd,
    destination: join(workspace, "packs", definition.key),
    spec: definition.spec,
  });
  const consumer = join(workspace, "consumers", definition.key);
  const nodeModulesSize = await installPackage({
    consumer,
    packageName: definition.key,
    tarball: packed.tarball,
  });
  packages.push({
    name: packed.name,
    version: packed.version,
    source: definition.source,
    spec: definition.spec ?? `oxdg@${packageJson.version}`,
    tarball: basename(packed.tarball),
    tarballSizeBytes: packed.tarballSize,
    unpackedSizeBytes: packed.unpackedSize,
    nodeModulesSizeBytes: nodeModulesSize,
  });
}

const result = {
  generatedAt: new Date().toISOString(),
  workspace,
  packages,
};
await writeFile(output, JSON.stringify(result, null, 2) + "\n", "utf8");
console.log(JSON.stringify(result, null, 2));
