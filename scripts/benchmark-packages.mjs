import { execFile as execFileCallback } from "node:child_process";
import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
  const { stdout } = await run(
    npm,
    ["pack", "--json", "--pack-destination", destination, spec],
    cwd,
  );
  const packed = parsePackResult(stdout);
  return { packed, tarball: join(destination, packed.filename) };
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
const releaseFootprintOption = optionValue("--release-footprint");
if (
  !workspaceOption ||
  !lockDirectoryOption ||
  !packageFootprintOption ||
  !releaseFootprintOption
) {
  throw new Error(
    "usage: node scripts/benchmark-packages.mjs --workspace DIR --locks DIR --package-footprint FILE --release-footprint FILE",
  );
}

const workspace = resolve(workspaceOption);
const lockDirectory = resolve(lockDirectoryOption);
const releaseFootprintPath = resolve(releaseFootprintOption);
const mainFootprint = JSON.parse(await readFile(resolve(packageFootprintOption), "utf8"));
if (mainFootprint.package !== "oxdg" || typeof mainFootprint.tarballFilename !== "string") {
  throw new Error("package footprint report is missing the oxdg tarball filename");
}
const mainTarball = join(workspace, "packs", "oxdg", mainFootprint.tarballFilename);
await lstat(mainTarball);
await mkdir(join(workspace, "packs"), { recursive: true });
await mkdir(join(workspace, "consumers"), { recursive: true });
await mkdir(lockDirectory, { recursive: true });
await writeFile(
  join(workspace, "package.json"),
  `${JSON.stringify({ name: "oxdg-benchmark-workspace", private: true })}\n`,
);

const releaseSpec = process.env.OXDG_RELEASE_SPEC ?? "oxdg@latest";
const releasePack = await packPackage({
  destination: join(workspace, "packs", "release"),
  cwd: workspace,
  spec: releaseSpec,
});
await installPackage({
  consumer: join(workspace, "consumers", "release"),
  packageName: "release",
  tarball: releasePack.tarball,
  lockDirectory,
});
const releasePackageJson = JSON.parse(
  await readFile(
    join(workspace, "consumers", "release", "node_modules", "oxdg", "package.json"),
    "utf8",
  ),
);
const releaseFootprint = {
  package: releasePackageJson.name,
  version: releasePackageJson.version,
  spec: releaseSpec,
  tarballFilename: releasePack.packed.filename,
  packedSizeBytes: (await lstat(releasePack.tarball)).size,
  unpackedSizeBytes: releasePack.packed.unpackedSize,
  nodeModulesSizeBytes: await directorySize(
    join(workspace, "consumers", "release", "node_modules"),
  ),
  fileCount: Array.isArray(releasePack.packed.files) ? releasePack.packed.files.length : undefined,
  measuredAt: new Date().toISOString(),
};
await writeFile(releaseFootprintPath, `${JSON.stringify(releaseFootprint, null, 2)}\n`);

await installPackage({
  consumer: join(workspace, "consumers", "main"),
  packageName: "main",
  tarball: mainTarball,
  lockDirectory,
});

for (const definition of [
  { key: "madge", spec: `madge@${process.env.MADGE_VERSION ?? "8.0.0"}` },
  { key: "dpdm", spec: `dpdm@${process.env.DPDM_VERSION ?? "4.3.0"}` },
]) {
  const packed = await packPackage({
    destination: join(workspace, "packs", definition.key),
    cwd: workspace,
    spec: definition.spec,
  });
  await installPackage({
    consumer: join(workspace, "consumers", definition.key),
    packageName: definition.key,
    tarball: packed.tarball,
    lockDirectory,
  });
}

console.log(
  `Installed released oxdg ${releasePackageJson.version}, main oxdg, Madge, and dpdm in clean consumers; dependency locks saved to ${lockDirectory}`,
);
