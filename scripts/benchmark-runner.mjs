import { execFile as execFileCallback, execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { delimiter, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const extensions = ["js", "jsx", "ts", "tsx", "mjs", "cjs", "mts", "cts"];
const extensionSet = new Set(extensions.map((extension) => `.${extension}`));
const warmup = 8;
const runs = 20;

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readCommand(command, args = []) {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

async function countSourceFiles(directory) {
  let count = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      count += await countSourceFiles(path);
    } else if (entry.isFile() && extensionSet.has(extname(entry.name))) {
      count += 1;
    }
  }
  return count;
}

async function readPackageVersion(path) {
  const packageJson = JSON.parse(await readFile(path, "utf8"));
  return packageJson.version;
}

async function runHyperfine({ commands, output, cwd, env }) {
  const args = [
    "--warmup",
    String(warmup),
    "--runs",
    String(runs),
    "--shell",
    "bash",
    "--export-json",
    output,
  ];
  for (const command of commands) args.push(command);
  try {
    const { stdout, stderr } = await execFile("hyperfine", args, {
      cwd,
      env,
      maxBuffer: 10 * 1024 * 1024,
    });
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
  } catch (error) {
    const detail = [error.stdout, error.stderr].filter(Boolean).join("\n");
    throw new Error(`hyperfine failed${detail ? `:\n${detail}` : ""}`, { cause: error });
  }
}

const honoDirOption = optionValue("--hono-dir");
const workspaceOption = optionValue("--workspace");
const outputOption = optionValue("--output");
const footprintOption = optionValue("--package-footprint");
if (!honoDirOption || !workspaceOption || !footprintOption) {
  throw new Error(
    "usage: node scripts/benchmark-runner.mjs --hono-dir DIR --workspace DIR --package-footprint FILE [--output DIR]",
  );
}

const honoDir = resolve(honoDirOption);
const workspace = resolve(workspaceOption);
const outputDirectory = resolve(outputOption ?? ".");
const packageFootprint = JSON.parse(await readFile(resolve(footprintOption), "utf8"));
const sourceDirectory = join(honoDir, "src");
const entrypoint = join(sourceDirectory, "index.ts");

if (
  !(await readFile(entrypoint, "utf8").then(
    () => true,
    () => false,
  ))
) {
  throw new Error(`benchmark entrypoint does not exist: ${entrypoint}`);
}
const sourceFileCount = await countSourceFiles(sourceDirectory);
if (sourceFileCount === 0) throw new Error(`no benchmark source files found in ${sourceDirectory}`);

const toolBinDirectories = ["oxdg", "madge", "dpdm"].map((tool) =>
  join(workspace, "consumers", tool, "node_modules", ".bin"),
);
const env = {
  ...process.env,
  PATH: [...toolBinDirectories, process.env.PATH ?? ""].join(delimiter),
};
const directoryCommands = {
  madge: `madge --extensions ${extensions.join(",")} src`,
  oxdg: `oxdg --extensions ${extensions.join(",")} src`,
  dpdm: `dpdm 'src/**/*.{${extensions.join(",")}}'`,
};
const entrypointCommands = {
  madge: `madge --extensions ${extensions.join(",")} src/index.ts`,
  oxdg: `oxdg --extensions ${extensions.join(",")} src/index.ts`,
  dpdm: `dpdm --extensions ${extensions.join(",")} src/index.ts`,
};

await mkdir(outputDirectory, { recursive: true });
const directoryOutput = join(outputDirectory, "benchmark-directory.json");
const entrypointOutput = join(outputDirectory, "benchmark-entrypoint.json");
await Promise.all([rm(directoryOutput, { force: true }), rm(entrypointOutput, { force: true })]);
await runHyperfine({
  commands: [directoryCommands.madge, directoryCommands.oxdg, directoryCommands.dpdm],
  output: directoryOutput,
  cwd: honoDir,
  env,
});
await runHyperfine({
  commands: [entrypointCommands.madge, entrypointCommands.oxdg, entrypointCommands.dpdm],
  output: entrypointOutput,
  cwd: honoDir,
  env,
});

const honoCommit = readCommand("git", ["-C", honoDir, "rev-parse", "HEAD"]);
if (process.env.HONO_COMMIT && honoCommit !== process.env.HONO_COMMIT) {
  throw new Error(`Hono commit ${honoCommit} does not match ${process.env.HONO_COMMIT}`);
}
const oxdgCommit = readCommand("git", ["-C", projectRoot, "rev-parse", "HEAD"]);
const metadata = {
  runner: {
    label: process.env.RUNNER_LABEL ?? "local",
    imageOS: process.env.ImageOS ?? "unknown",
    imageVersion: process.env.ImageVersion ?? "unknown",
    workflowRunId: process.env.GITHUB_RUN_ID ?? null,
    workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
  },
  host: {
    uname: readCommand("uname", ["-a"]),
    cpu: JSON.parse(readCommand("lscpu", ["-J"])),
  },
  corpus: {
    repository: process.env.HONO_REPOSITORY ?? "https://github.com/honojs/hono.git",
    commit: honoCommit,
    name: "honojs/hono",
  },
  tools: {
    oxdg: {
      version: await readPackageVersion(join(projectRoot, "package.json")),
      gitCommit: oxdgCommit,
    },
    madge: {
      version: await readPackageVersion(
        join(workspace, "consumers/madge/node_modules/madge/package.json"),
      ),
    },
    dpdm: {
      version: await readPackageVersion(
        join(workspace, "consumers/dpdm/node_modules/dpdm/package.json"),
      ),
    },
  },
  runtimes: {
    node: { requested: process.env.NODE_VERSION ?? "unknown", actual: process.version },
    bun: {
      requested: process.env.BUN_VERSION ?? "unknown",
      actual: readCommand("bun", ["--version"]),
    },
    npm: readCommand("npm", ["--version"]),
    hyperfine: {
      requested: process.env.HYPERFINE_VERSION ?? "unknown",
      actual: readCommand("hyperfine", ["--version"]),
    },
  },
  benchmark: { warmup, runs },
  packageFootprint,
  workloads: {
    directory: {
      input: "src",
      extensions,
      files: sourceFileCount,
      commands: directoryCommands,
      workingDirectory: honoDir,
    },
    entrypoint: {
      input: "src/index.ts",
      extensions,
      commands: entrypointCommands,
      workingDirectory: honoDir,
    },
  },
};

await writeFile(
  join(outputDirectory, "benchmark-metadata.json"),
  `${JSON.stringify(metadata, null, 2)}\n`,
);
await writeFile(
  join(outputDirectory, "benchmark-commands.json"),
  `${JSON.stringify(
    {
      directory: directoryCommands,
      entrypoint: entrypointCommands,
    },
    null,
    2,
  )}\n`,
);
console.log(`Benchmarked ${sourceFileCount} files in ${honoDir}/src at Hono ${honoCommit}`);
