import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requiredOption(name) {
  const value = optionValue(name);
  if (!value) throw new Error(`missing required option: ${name}`);
  return value;
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

function formatDuration(seconds) {
  if (seconds < 1) return `${(seconds * 1000).toFixed(1)} ms`;
  return `${seconds.toFixed(2)} s`;
}

function formatDelta(base, current) {
  if (base === 0) return "—";
  const percent = ((current - base) / base) * 100;
  if (Math.abs(percent) < 0.05) return "0.0%";
  return `${percent > 0 ? "+" : ""}${percent.toFixed(1)}%`;
}

function formatTiming(result) {
  return `${formatDuration(result.mean)} ± ${formatDuration(result.stddev)}`;
}

function hyperfinePair(raw) {
  if (!Array.isArray(raw.results) || raw.results.length !== 2) {
    throw new Error("expected exactly two hyperfine results");
  }
  const [base, current] = raw.results;
  for (const result of [base, current]) {
    if (typeof result.mean !== "number" || typeof result.stddev !== "number") {
      throw new Error("hyperfine result is missing mean/stddev");
    }
  }
  return { base, current };
}

const baseFootprint = JSON.parse(
  await readFile(resolve(requiredOption("--base-footprint")), "utf8"),
);
const currentFootprint = JSON.parse(
  await readFile(resolve(requiredOption("--current-footprint")), "utf8"),
);
const build = hyperfinePair(JSON.parse(await readFile(resolve(requiredOption("--build")), "utf8")));
const analysis = hyperfinePair(
  JSON.parse(await readFile(resolve(requiredOption("--analysis")), "utf8")),
);
const output = resolve(requiredOption("--output"));
const baseLabel = optionValue("--base-label") ?? "main";
const currentLabel = optionValue("--current-label") ?? "PR";
const corpusCommit = optionValue("--corpus-commit") ?? "unknown";

const packageRows = [
  [
    "Packed package",
    formatBytes(baseFootprint.packedSizeBytes),
    formatBytes(currentFootprint.packedSizeBytes),
    formatDelta(baseFootprint.packedSizeBytes, currentFootprint.packedSizeBytes),
  ],
  [
    "Unpacked package",
    formatBytes(baseFootprint.unpackedSizeBytes),
    formatBytes(currentFootprint.unpackedSizeBytes),
    formatDelta(baseFootprint.unpackedSizeBytes, currentFootprint.unpackedSizeBytes),
  ],
  [
    "Installed node_modules",
    formatBytes(baseFootprint.nodeModulesSizeBytes),
    formatBytes(currentFootprint.nodeModulesSizeBytes),
    formatDelta(baseFootprint.nodeModulesSizeBytes, currentFootprint.nodeModulesSizeBytes),
  ],
];

const performanceRows = [
  [
    "Build",
    formatTiming(build.base),
    formatTiming(build.current),
    formatDelta(build.base.mean, build.current.mean),
  ],
  [
    "Hono directory analysis",
    formatTiming(analysis.base),
    formatTiming(analysis.current),
    formatDelta(analysis.base.mean, analysis.current.mean),
  ],
];

const table = (rows) => [
  `| Metric | ${baseLabel} | ${currentLabel} | Δ |`,
  "| --- | ---: | ---: | ---: |",
  ...rows.map((row) => `| ${row.join(" | ")} |`),
];

const body = [
  "<!-- oxdg-pr-metrics -->",
  "## PR metrics",
  "",
  "A lightweight comparison against the PR base. Lower values are better; timing measurements are informational and may vary on hosted runners.",
  "",
  "### Package footprint",
  "",
  ...table(packageRows),
  "",
  "### Performance",
  "",
  ...table(performanceRows),
  "",
  "<details>",
  "<summary>Measurement details</summary>",
  "",
  `- Build: 2 warmups, 5 measured runs per revision.`,
  `- Processing: fixed Hono corpus at \`${corpusCommit}\`, 5 warmups, 15 measured runs per revision.`,
  "- Timing cells show mean ± standard deviation.",
  "- Package footprint uses the same packed-package validation as release checks.",
  "- These metrics do not gate the PR.",
  "",
  "</details>",
  "",
].join("\n");

await writeFile(output, body, "utf8");
console.log(body);
