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

function requiredOption(name) {
  const value = optionValue(name);
  if (!value) throw new Error(`missing required option: ${name}`);
  return value;
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
    ...commands,
  ];
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

function commandsFor(directoryInput, entrypointInput) {
  const extensionList = extensions.join(",");
  return {
    directory: {
      madge: `madge --extensions ${extensionList} ${directoryInput}`,
      oxdg: `oxdg --extensions ${extensionList} ${directoryInput}`,
      dpdm: `dpdm '${directoryInput}/**/*.{${extensionList}}'`,
    },
    entrypoint: {
      madge: `madge --extensions ${extensionList} ${entrypointInput}`,
      oxdg: `oxdg --extensions ${extensionList} ${entrypointInput}`,
      dpdm: `dpdm --extensions ${extensionList} ${entrypointInput}`,
    },
  };
}

const workspace = resolve(requiredOption("--workspace"));
const outputDirectory = resolve(optionValue("--output") ?? ".");
const packageFootprint = JSON.parse(
  await readFile(resolve(requiredOption("--package-footprint")), "utf8"),
);

const corpusDefinitions = [
  {
    key: "hono",
    name: "honojs/hono",
    profile: "ESM / TypeScript",
    repository: process.env.HONO_REPOSITORY ?? "https://github.com/honojs/hono.git",
    expectedCommit: process.env.HONO_COMMIT,
    directory: resolve(requiredOption("--hono-dir")),
    directoryInput: "src",
    entrypointInput: "src/index.ts",
  },
  {
    key: "webpack",
    name: "webpack/webpack",
    profile: "CommonJS / JavaScript",
    repository: process.env.WEBPACK_REPOSITORY ?? "https://github.com/webpack/webpack.git",
    expectedCommit: process.env.WEBPACK_COMMIT,
    directory: resolve(requiredOption("--webpack-dir")),
    directoryInput: "lib",
    entrypointInput: "lib/index.js",
  },
];

const toolBinDirectories = ["oxdg", "madge", "dpdm"].map((tool) =>
  join(workspace, "consumers", tool, "node_modules", ".bin"),
);
const env = {
  ...process.env,
  PATH: [...toolBinDirectories, process.env.PATH ?? ""].join(delimiter),
};

await mkdir(outputDirectory, { recursive: true });
const corpora = {};
const commandArtifact = {};

for (const definition of corpusDefinitions) {
  const sourceDirectory = join(definition.directory, definition.directoryInput);
  const entrypoint = join(definition.directory, definition.entrypointInput);
  await readFile(entrypoint, "utf8").catch((error) => {
    throw new Error(`benchmark entrypoint does not exist: ${entrypoint}`, { cause: error });
  });

  const sourceFileCount = await countSourceFiles(sourceDirectory);
  if (sourceFileCount === 0) {
    throw new Error(`no benchmark source files found in ${sourceDirectory}`);
  }

  const commands = commandsFor(definition.directoryInput, definition.entrypointInput);
  const directoryOutput = join(outputDirectory, `benchmark-${definition.key}-directory.json`);
  const entrypointOutput = join(outputDirectory, `benchmark-${definition.key}-entrypoint.json`);
  await Promise.all([rm(directoryOutput, { force: true }), rm(entrypointOutput, { force: true })]);

  await runHyperfine({
    commands: [commands.directory.madge, commands.directory.oxdg, commands.directory.dpdm],
    output: directoryOutput,
    cwd: definition.directory,
    env,
  });
  await runHyperfine({
    commands: [commands.entrypoint.madge, commands.entrypoint.oxdg, commands.entrypoint.dpdm],
    output: entrypointOutput,
    cwd: definition.directory,
    env,
  });

  const commit = readCommand("git", ["-C", definition.directory, "rev-parse", "HEAD"]);
  if (definition.expectedCommit && commit !== definition.expectedCommit) {
    throw new Error(
      `${definition.name} commit ${commit} does not match ${definition.expectedCommit}`,
    );
  }

  corpora[definition.key] = {
    name: definition.name,
    profile: definition.profile,
    repository: definition.repository,
    commit,
    workloads: {
      directory: {
        input: definition.directoryInput,
        extensions,
        files: sourceFileCount,
        commands: commands.directory,
        workingDirectory: definition.directory,
      },
      entrypoint: {
        input: definition.entrypointInput,
        extensions,
        commands: commands.entrypoint,
        workingDirectory: definition.directory,
      },
    },
  };
  commandArtifact[definition.key] = commands;
  console.log(
    `Benchmarked ${sourceFileCount} files in ${definition.name} ${definition.directoryInput} at ${commit}`,
  );
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
  corpora,
};

await writeFile(
  join(outputDirectory, "benchmark-metadata.json"),
  `${JSON.stringify(metadata, null, 2)}\n`,
);
await writeFile(
  join(outputDirectory, "benchmark-commands.json"),
  `${JSON.stringify(commandArtifact, null, 2)}\n`,
);
