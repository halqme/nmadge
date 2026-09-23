import { execFile as execFileCallback } from "node:child_process";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

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

async function packPackage({ destination, cwd, spec }) {
  await rm(destination, { force: true, recursive: true });
  await mkdir(destination, { recursive: true });
  const { stdout } = await run(
    npm,
    ["pack", "--json", "--pack-destination", destination, spec],
    cwd,
  );
  const packed = parsePackResult(stdout);
  return join(destination, packed.filename);
}

async function installPackage({ consumer, packageName, tarball, lockDirectory }) {
  await rm(consumer, { force: true, recursive: true });
  await mkdir(consumer, { recursive: true });
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify(
      { name: `oxdg-benchmark-${packageName}`, private: true, type: "module" },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  await run(npm, ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], consumer);
  const { stdout } = await run(npm, ["ls", "--all", "--json"], consumer);
  await writeFile(
    join(lockDirectory, `${packageName}.npm-ls.json`),
    `${JSON.stringify(JSON.parse(stdout), null, 2)}\n`,
  );
  await writeFile(
    join(lockDirectory, `${packageName}.package-lock.json`),
    await readFile(join(consumer, "package-lock.json"), "utf8"),
  );
}

const workspaceOption = optionValue("--workspace");
const lockDirectoryOption = optionValue("--locks");
const packageFootprintOption = optionValue("--package-footprint");
if (!workspaceOption || !lockDirectoryOption || !packageFootprintOption) {
  throw new Error(
    "usage: node scripts/benchmark-packages.mjs --workspace DIR --locks DIR --package-footprint FILE",
  );
}

const workspace = resolve(workspaceOption);
const lockDirectory = resolve(lockDirectoryOption);
const packageFootprint = JSON.parse(await readFile(resolve(packageFootprintOption), "utf8"));
if (packageFootprint.package !== "oxdg" || typeof packageFootprint.tarballFilename !== "string") {
  throw new Error("package footprint report is missing the oxdg tarball filename");
}
const oxdgTarball = join(workspace, "packs", "oxdg", packageFootprint.tarballFilename);
await lstat(oxdgTarball);
await mkdir(join(workspace, "packs"), { recursive: true });
await mkdir(join(workspace, "consumers"), { recursive: true });
await mkdir(lockDirectory, { recursive: true });
await writeFile(
  join(workspace, "package.json"),
  `${JSON.stringify({ name: "oxdg-benchmark-workspace", private: true })}\n`,
);

const packages = [
  { key: "oxdg", tarball: oxdgTarball },
  { key: "madge", spec: `madge@${process.env.MADGE_VERSION ?? "8.0.0"}` },
  { key: "dpdm", spec: `dpdm@${process.env.DPDM_VERSION ?? "4.3.0"}` },
];
for (const definition of packages) {
  const tarball =
    definition.tarball ??
    (await packPackage({
      destination: join(workspace, "packs", definition.key),
      cwd: workspace,
      spec: definition.spec,
    }));
  await installPackage({
    consumer: join(workspace, "consumers", definition.key),
    packageName: definition.key,
    tarball,
    lockDirectory,
  });
}
console.log(
  `Installed oxdg, Madge, and dpdm in clean consumers; dependency locks saved to ${lockDirectory}`,
);
