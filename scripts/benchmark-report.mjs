import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const toolOrder = ["oxdg", "dpdm", "madge"];
const toolLabels = { oxdg: "oxdg", dpdm: "dpdm", madge: "Madge" };

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatDuration(milliseconds) {
  return `${milliseconds.toFixed(1)} ms`;
}

function formatRelative(ratio) {
  if (Math.abs(ratio - 1) < 0.005) return "1.00×";
  return ratio > 1 ? `${ratio.toFixed(2)}× slower` : `${(1 / ratio).toFixed(2)}× faster`;
}

function comparisonForOxdg(ratio, tool) {
  if (Math.abs(ratio - 1) < 0.005) return `at parity with ${toolLabels[tool]}`;
  return ratio > 1
    ? `${ratio.toFixed(2)}× faster than ${toolLabels[tool]}`
    : `${(1 / ratio).toFixed(2)}× slower than ${toolLabels[tool]}`;
}

function cpuDetails(cpu) {
  const entries = cpu?.lscpu ?? [];
  const field = (name) =>
    entries.find((entry) => entry.field?.replace(/:$/, "") === name)?.data ?? "unknown";
  return `${field("Model name")} (${field("CPU(s)")} logical CPUs)`;
}

function normalizeWorkload(name, raw, metadata) {
  const workload = metadata.workloads[name];
  if (!workload || !workload.commands)
    throw new Error(`benchmark metadata is missing ${name} commands`);
  const commandToTool = new Map(
    Object.entries(workload.commands).map(([tool, command]) => [command, tool]),
  );
  const results = {};
  for (const item of raw.results ?? []) {
    const tool = commandToTool.get(item.command);
    if (!tool) throw new Error(`unrecognized ${name} benchmark command: ${item.command}`);
    for (const key of ["mean", "stddev", "median", "min", "max"]) {
      if (typeof item[key] !== "number" || !Number.isFinite(item[key])) {
        throw new Error(`hyperfine result for ${tool} is missing numeric ${key}`);
      }
    }
    results[tool] = {
      command: item.command,
      meanSeconds: item.mean,
      stddevSeconds: item.stddev,
      medianSeconds: item.median,
      minSeconds: item.min,
      maxSeconds: item.max,
      meanMs: item.mean * 1000,
      stddevMs: item.stddev * 1000,
      medianMs: item.median * 1000,
      minMs: item.min * 1000,
      maxMs: item.max * 1000,
    };
  }
  for (const tool of toolOrder) {
    if (!results[tool]) throw new Error(`${name} benchmark results are missing ${tool}`);
  }

  const baseline = results.oxdg.meanSeconds;
  const relativePerformance = Object.fromEntries(
    ["dpdm", "madge"].map((tool) => {
      const ratio = results[tool].meanSeconds / baseline;
      return [tool, { ratioToOxdg: ratio, label: formatRelative(ratio) }];
    }),
  );
  return {
    input: workload.input,
    extensions: workload.extensions,
    ...(workload.files === undefined ? {} : { files: workload.files }),
    commands: workload.commands,
    results,
    relativePerformance,
  };
}

function makeMarkdown(report) {
  const { corpus, environment, benchmark, workloads, packageFootprint } = report;
  const resultsSummary = ["directory", "entrypoint"].map((key) => {
    const workload = workloads[key];
    const comparisons = ["dpdm", "madge"].map((tool) =>
      comparisonForOxdg(workload.relativePerformance[tool].ratioToOxdg, tool),
    );
    return `- **${key === "directory" ? "Directory-wide" : "Entrypoint"}:** ${formatDuration(workload.results.oxdg.meanMs)} (${comparisons.join(", ")})`;
  });
  const table = (workload) => [
    "| Tool | Mean | Stddev | Median | Min | Max | Relative |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...toolOrder.map((tool) => {
      const result = workload.results[tool];
      const relative = tool === "oxdg" ? "1.00×" : workload.relativePerformance[tool].label;
      return `| ${toolLabels[tool]} | ${formatDuration(result.meanMs)} | ${formatDuration(result.stddevMs)} | ${formatDuration(result.medianMs)} | ${formatDuration(result.minMs)} | ${formatDuration(result.maxMs)} | ${relative} |`;
    }),
  ];
  const commandLines = (key) => {
    const workload = workloads[key];
    return [
      `**${key === "directory" ? "Directory-wide analysis" : "Entrypoint analysis"}** (working directory: Hono checkout; input: \`${workload.input}\`)`,
      "",
      ...toolOrder.map((tool) => `- ${toolLabels[tool]}: \`${workload.commands[tool]}\``),
    ];
  };
  const image = `${environment.runner.imageOS} / ${environment.runner.imageVersion}`;
  const packageRows = packageFootprint
    ? [
        "| Metric | Value |",
        "| --- | ---: |",
        `| Packed package | ${formatBytes(packageFootprint.packedSizeBytes)} |`,
        `| Unpacked package | ${formatBytes(packageFootprint.unpackedSizeBytes)} |`,
        `| Installed node_modules | ${formatBytes(packageFootprint.nodeModulesSizeBytes)} |`,
      ]
    : ["Package footprint was not included in metadata."];

  return [
    "# Benchmark",
    "",
    `## Result summary: oxdg on ${corpus.name}`,
    "",
    `Corpus commit: \`${corpus.commit}\``,
    ...resultsSummary,
    "",
    "## Directory-wide analysis",
    "",
    ...table(workloads.directory),
    "",
    "## Entrypoint analysis",
    "",
    ...table(workloads.entrypoint),
    "",
    "## Input equivalence",
    "",
    "| Workload | Input | Extensions | Source files |",
    "| --- | --- | --- | ---: |",
    `| Directory-wide | \`${workloads.directory.input}\` | ${workloads.directory.extensions.join(", ")} | ${workloads.directory.files} |`,
    `| Entrypoint | \`${workloads.entrypoint.input}\` | ${workloads.entrypoint.extensions.join(", ")} | — |`,
    "",
    `Corpus repository: ${corpus.repository}`,
    `Corpus commit: \`${corpus.commit}\``,
    "",
    ...commandLines("directory"),
    "",
    ...commandLines("entrypoint"),
    "",
    "## Environment",
    "",
    "| Property | Value |",
    "| --- | --- |",
    `| Runner | ${environment.runner.label} |`,
    `| Runner image | ${image} |`,
    `| CPU | ${cpuDetails(environment.host.cpu)} |`,
    `| Hono repository / commit | ${corpus.repository} / \`${corpus.commit}\` |`,
    `| Madge | ${environment.tools.madge.version} |`,
    `| dpdm | ${environment.tools.dpdm.version} |`,
    `| oxdg | ${environment.tools.oxdg.version} (Git \`${environment.tools.oxdg.gitCommit}\`) |`,
    `| Node.js | ${environment.runtimes.node.requested} (${environment.runtimes.node.actual}) |`,
    `| Bun | ${environment.runtimes.bun.requested} (${environment.runtimes.bun.actual}) |`,
    `| npm | ${environment.runtimes.npm} |`,
    `| hyperfine | ${environment.runtimes.hyperfine.requested} (${environment.runtimes.hyperfine.actual}) |`,
    `| hyperfine runs | ${benchmark.warmup} warmups, ${benchmark.runs} measured runs |`,
    `| GitHub workflow run ID | ${environment.runner.workflowRunId ?? "local"} |`,
    "",
    "### Host details",
    "",
    `- uname: \`${environment.host.uname}\``,
    "",
    "## Package footprint",
    "",
    ...packageRows,
    "",
    "Package footprint is measured by the shared package validation script; the 500 KiB unpacked-size limit is enforced during the check.",
    "",
    "## Artifacts",
    "",
    "The `benchmark` artifact contains raw hyperfine JSON for both workloads, normalized `latest.json`, environment metadata, exact commands, dependency lockfiles, package footprint JSON, and this generated summary.",
    "",
  ].join("\n");
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

function makeHtml(report) {
  const workloadSection = (title, workload) => {
    const rows = toolOrder
      .map((tool) => {
        const result = workload.results[tool];
        const relative = tool === "oxdg" ? "1.00×" : workload.relativePerformance[tool].label;
        return `<tr><th>${toolLabels[tool]}</th><td>${formatDuration(result.meanMs)}</td><td>${formatDuration(result.stddevMs)}</td><td>${formatDuration(result.medianMs)}</td><td>${formatDuration(result.minMs)}</td><td>${formatDuration(result.maxMs)}</td><td>${relative}</td></tr>`;
      })
      .join("\n");
    const commands = toolOrder
      .map(
        (tool) =>
          `<li><strong>${toolLabels[tool]}</strong><pre><code>${escapeHtml(workload.commands[tool])}</code></pre></li>`,
      )
      .join("\n");
    const extensionText = Array.isArray(workload.extensions)
      ? ` · extensions: ${escapeHtml(workload.extensions.join(", "))}`
      : "";
    const fileText = workload.files === undefined ? "" : ` · ${workload.files} source files`;
    return `<section><h2>${title}</h2><p>Input: <code>${escapeHtml(workload.input)}</code>${fileText}${extensionText}</p><div class="table-wrap"><table><thead><tr><th>Tool</th><th>Mean</th><th>Stddev</th><th>Median</th><th>Min</th><th>Max</th><th>Relative to oxdg</th></tr></thead><tbody>${rows}</tbody></table></div><h3>Exact commands</h3><ul>${commands}</ul></section>`;
  };
  const { corpus, environment, benchmark, workloads } = report;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>oxdg benchmark · ${escapeHtml(corpus.name)}</title><style>
:root{color-scheme:light dark;font:16px/1.55 system-ui,sans-serif}body{max-width:1100px;margin:0 auto;padding:2rem 1rem}h1,h2{line-height:1.2}h1{margin-bottom:.3rem}section{margin:2.5rem 0}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}th,td{padding:.55rem .7rem;border-bottom:1px solid #8885;text-align:right}th:first-child,td:first-child{text-align:left}thead{background:#8882}.table-wrap{overflow-x:auto}pre{overflow-x:auto;padding:.75rem;background:#8882;border-radius:.4rem}code{overflow-wrap:anywhere}.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:.7rem}.meta div{padding:.8rem;background:#8882;border-radius:.5rem}a{color:inherit}
</style></head><body>
<h1>oxdg on ${escapeHtml(corpus.name)}</h1><p>Fixed corpus commit <code>${escapeHtml(corpus.commit)}</code> · <a href="latest.json">normalized JSON</a></p>
${workloadSection("Directory-wide analysis", workloads.directory)}
${workloadSection("Entrypoint analysis", workloads.entrypoint)}
<section><h2>Environment</h2><div class="meta"><div><strong>Runner</strong><br>${escapeHtml(environment.runner.label)}<br>${escapeHtml(environment.runner.imageOS)} / ${escapeHtml(environment.runner.imageVersion)}</div><div><strong>CPU</strong><br>${escapeHtml(cpuDetails(environment.host.cpu))}<br>${escapeHtml(environment.host.uname)}</div><div><strong>Corpus</strong><br>${escapeHtml(corpus.repository)}<br><code>${escapeHtml(corpus.commit)}</code></div><div><strong>Tools</strong><br>oxdg ${escapeHtml(environment.tools.oxdg.version)} · dpdm ${escapeHtml(environment.tools.dpdm.version)} · Madge ${escapeHtml(environment.tools.madge.version)}</div><div><strong>Runtime</strong><br>Node ${escapeHtml(environment.runtimes.node.actual)} · Bun ${escapeHtml(environment.runtimes.bun.actual)} · npm ${escapeHtml(environment.runtimes.npm)} · hyperfine ${escapeHtml(environment.runtimes.hyperfine.actual)}</div><div><strong>hyperfine</strong><br>${benchmark.warmup} warmups · ${benchmark.runs} runs<br>Workflow run ${escapeHtml(environment.runner.workflowRunId ?? "local")}</div></div></section>
<p>Generated report · <a href="badges/runtime.json">directory runtime badge data</a> · <a href="badges/entrypoint.json">entrypoint runtime badge data</a> · <a href="badges/vs-madge.json">Madge comparison badge data</a></p>
</body></html>
`;
}

const directoryOption = optionValue("--directory");
const entrypointOption = optionValue("--entrypoint");
const metadataOption = optionValue("--metadata");
const outputOption = optionValue("--output");
const summaryOption = optionValue("--summary");
if (!directoryOption || !entrypointOption || !metadataOption) {
  throw new Error(
    "usage: node scripts/benchmark-report.mjs --directory FILE --entrypoint FILE --metadata FILE [--output DIR] [--summary FILE]",
  );
}
const outputDirectory = resolve(outputOption ?? "benchmark-report");
const summaryPath = summaryOption ? resolve(summaryOption) : process.env.GITHUB_STEP_SUMMARY;
const [directoryRaw, entrypointRaw, metadata] = await Promise.all([
  readFile(resolve(directoryOption), "utf8").then(JSON.parse),
  readFile(resolve(entrypointOption), "utf8").then(JSON.parse),
  readFile(resolve(metadataOption), "utf8").then(JSON.parse),
]);
const report = {
  generatedAt: new Date().toISOString(),
  corpus: metadata.corpus,
  environment: {
    runner: metadata.runner,
    host: metadata.host,
    tools: metadata.tools,
    runtimes: metadata.runtimes,
  },
  benchmark: metadata.benchmark,
  workloads: {
    directory: normalizeWorkload("directory", directoryRaw, metadata),
    entrypoint: normalizeWorkload("entrypoint", entrypointRaw, metadata),
  },
  packageFootprint: metadata.packageFootprint,
};
const summary = makeMarkdown(report);
const directoryWorkload = report.workloads.directory;
const runtimeBadge = {
  schemaVersion: 1,
  label: "Hono benchmark",
  message: `${Math.round(directoryWorkload.results.oxdg.meanMs)} ms`,
  color: "blue",
};
const entrypointBadge = {
  schemaVersion: 1,
  label: "Hono entrypoint",
  message: `${Math.round(report.workloads.entrypoint.results.oxdg.meanMs)} ms`,
  color: "blue",
};
const madgeRatio = directoryWorkload.relativePerformance.madge.ratioToOxdg;
const comparisonBadge = {
  schemaVersion: 1,
  label: "Hono vs Madge",
  message:
    madgeRatio >= 1 ? `${madgeRatio.toFixed(2)}× faster` : `${(1 / madgeRatio).toFixed(2)}× slower`,
  color: "blue",
};

await mkdir(join(outputDirectory, "badges"), { recursive: true });
await Promise.all([
  writeFile(join(outputDirectory, "summary.md"), summary, "utf8"),
  writeFile(join(outputDirectory, "latest.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8"),
  writeFile(join(outputDirectory, "index.html"), makeHtml(report), "utf8"),
  writeFile(
    join(outputDirectory, "badges/runtime.json"),
    `${JSON.stringify(runtimeBadge, null, 2)}\n`,
    "utf8",
  ),
  writeFile(
    join(outputDirectory, "badges/entrypoint.json"),
    `${JSON.stringify(entrypointBadge, null, 2)}\n`,
    "utf8",
  ),
  writeFile(
    join(outputDirectory, "badges/vs-madge.json"),
    `${JSON.stringify(comparisonBadge, null, 2)}\n`,
    "utf8",
  ),
]);
if (summaryPath) {
  await mkdir(dirname(summaryPath), { recursive: true });
  await appendFile(summaryPath, `${summary}\n`, "utf8");
}
console.log(`Wrote benchmark report to ${outputDirectory}`);
