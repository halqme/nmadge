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
  const { corpus, environment, benchmark, workloads, packageFootprint, generatedAt } = report;

  const comparisonText = (workload) =>
    ["dpdm", "madge"]
      .map((tool) => comparisonForOxdg(workload.relativePerformance[tool].ratioToOxdg, tool))
      .join(" · ");

  const workloadTable = (title, description, workload) => {
    const rows = toolOrder
      .map((tool) => {
        const result = workload.results[tool];
        const relative = tool === "oxdg" ? "baseline" : workload.relativePerformance[tool].label;
        return `<tr class="${tool === "oxdg" ? "primary-row" : ""}">
          <th scope="row">${escapeHtml(toolLabels[tool])}</th>
          <td>${formatDuration(result.meanMs)}</td>
          <td>± ${formatDuration(result.stddevMs)}</td>
          <td>${formatDuration(result.medianMs)}</td>
          <td>${formatDuration(result.minMs)}</td>
          <td>${formatDuration(result.maxMs)}</td>
          <td>${escapeHtml(relative)}</td>
        </tr>`;
      })
      .join("");

    return `<section class="panel">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Workload</p>
          <h2>${escapeHtml(title)}</h2>
          <p>${escapeHtml(description)}</p>
        </div>
        <div class="result-callout">
          <strong>${formatDuration(workload.results.oxdg.meanMs)}</strong>
          <span>${escapeHtml(comparisonText(workload))}</span>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Tool</th><th>Mean</th><th>Stddev</th><th>Median</th><th>Min</th><th>Max</th><th>Relative</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>`;
  };

  const commandList = (key) => {
    const workload = workloads[key];
    return `<div class="command-group">
      <h3>${key === "directory" ? "Directory-wide" : "Entrypoint"}</h3>
      <p>Working directory: Hono checkout · input: <code>${escapeHtml(workload.input)}</code></p>
      <ul class="commands">
        ${toolOrder
          .map(
            (tool) =>
              `<li><span>${escapeHtml(toolLabels[tool])}</span><code>${escapeHtml(workload.commands[tool])}</code></li>`,
          )
          .join("")}
      </ul>
    </div>`;
  };

  const packageSection = packageFootprint
    ? `<section class="panel">
        <div class="section-heading compact">
          <div>
            <p class="eyebrow">Package</p>
            <h2>Footprint</h2>
            <p>Measured from the same built package used by the benchmark.</p>
          </div>
          <div class="result-callout">
            <strong>${formatBytes(packageFootprint.unpackedSizeBytes)}</strong>
            <span>unpacked package</span>
          </div>
        </div>
        <div class="metric-grid">
          <div><span>Packed</span><strong>${formatBytes(packageFootprint.packedSizeBytes)}</strong></div>
          <div><span>Unpacked</span><strong>${formatBytes(packageFootprint.unpackedSizeBytes)}</strong></div>
          <div><span>Installed node_modules</span><strong>${formatBytes(packageFootprint.nodeModulesSizeBytes)}</strong></div>
        </div>
      </section>`
    : "";

  const runnerImage = `${environment.runner.imageOS} / ${environment.runner.imageVersion}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>oxdg benchmark · ${escapeHtml(corpus.name)}</title>
<style>
:root {
  color-scheme: light dark;
  --bg: #f7f7f8;
  --surface: #ffffff;
  --surface-soft: #f1f3f5;
  --text: #18181b;
  --muted: #666a73;
  --border: #dfe2e6;
  --accent: #315efb;
  --accent-soft: #eef2ff;
  --code: #f4f4f5;
  font: 16px/1.55 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d0f12;
    --surface: #15181d;
    --surface-soft: #1c2026;
    --text: #f2f3f5;
    --muted: #a7adb7;
    --border: #2c323b;
    --accent: #8ca8ff;
    --accent-soft: #1c274a;
    --code: #20242a;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
}
main {
  width: min(1120px, calc(100% - 2rem));
  margin: 0 auto;
  padding: 3.5rem 0 5rem;
}
a { color: var(--accent); }
code {
  font: .92em ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  background: var(--code);
  padding: .12rem .3rem;
  border-radius: .3rem;
}
.hero {
  margin-bottom: 2rem;
}
.hero h1 {
  margin: 0;
  font-size: clamp(2rem, 5vw, 3.4rem);
  line-height: 1.05;
  letter-spacing: -.04em;
}
.hero > p {
  max-width: 760px;
  margin: .85rem 0 0;
  color: var(--muted);
  font-size: 1.05rem;
}
.hero-meta {
  display: flex;
  flex-wrap: wrap;
  gap: .5rem 1rem;
  margin-top: 1rem;
  color: var(--muted);
  font-size: .9rem;
}
.summary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: .8rem;
  margin: 2rem 0;
}
.summary-card, .panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: .9rem;
}
.summary-card {
  padding: 1rem 1.1rem;
}
.summary-card span {
  display: block;
  color: var(--muted);
  font-size: .82rem;
  text-transform: uppercase;
  letter-spacing: .06em;
}
.summary-card strong {
  display: block;
  margin-top: .2rem;
  font-size: 1.55rem;
  letter-spacing: -.02em;
}
.summary-card p {
  margin: .3rem 0 0;
  color: var(--muted);
  font-size: .86rem;
}
.panel {
  margin: 1rem 0;
  padding: 1.25rem;
}
.section-heading {
  display: flex;
  justify-content: space-between;
  gap: 2rem;
  align-items: flex-start;
  margin-bottom: 1rem;
}
.section-heading.compact { margin-bottom: .8rem; }
.section-heading h2 {
  margin: .05rem 0 .25rem;
  font-size: 1.35rem;
  letter-spacing: -.02em;
}
.section-heading p:not(.eyebrow) {
  margin: 0;
  color: var(--muted);
}
.eyebrow {
  margin: 0;
  color: var(--accent);
  font-size: .75rem;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
}
.result-callout {
  min-width: 190px;
  text-align: right;
}
.result-callout strong {
  display: block;
  font-size: 1.35rem;
}
.result-callout span {
  display: block;
  margin-top: .15rem;
  color: var(--muted);
  font-size: .82rem;
}
.table-wrap {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: .65rem;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
th, td {
  padding: .65rem .75rem;
  border-bottom: 1px solid var(--border);
  text-align: right;
}
th:first-child, td:first-child { text-align: left; }
thead th {
  background: var(--surface-soft);
  color: var(--muted);
  font-size: .8rem;
  font-weight: 600;
}
tbody tr:last-child th, tbody tr:last-child td { border-bottom: 0; }
.primary-row {
  background: var(--accent-soft);
}
.primary-row th {
  color: var(--accent);
}
.metric-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border: 1px solid var(--border);
  border-radius: .65rem;
  overflow: hidden;
}
.metric-grid div {
  padding: .85rem 1rem;
  border-right: 1px solid var(--border);
}
.metric-grid div:last-child { border-right: 0; }
.metric-grid span {
  display: block;
  color: var(--muted);
  font-size: .8rem;
}
.metric-grid strong {
  display: block;
  margin-top: .2rem;
  font-variant-numeric: tabular-nums;
}
details.panel summary {
  cursor: pointer;
  font-weight: 650;
}
.details-body {
  margin-top: 1.2rem;
}
.meta-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: .55rem;
}
.meta-grid div {
  padding: .75rem .85rem;
  background: var(--surface-soft);
  border-radius: .55rem;
}
.meta-grid span {
  display: block;
  color: var(--muted);
  font-size: .78rem;
}
.meta-grid strong {
  display: block;
  margin-top: .15rem;
  font-size: .9rem;
  overflow-wrap: anywhere;
}
.command-group { margin-top: 1.25rem; }
.command-group h3 { margin-bottom: .2rem; }
.command-group > p { margin-top: 0; color: var(--muted); font-size: .9rem; }
.commands {
  padding: 0;
  margin: .65rem 0 0;
  list-style: none;
}
.commands li {
  display: grid;
  grid-template-columns: 80px 1fr;
  gap: .75rem;
  align-items: start;
  margin: .45rem 0;
}
.commands span { color: var(--muted); }
.commands code {
  overflow-wrap: anywhere;
  white-space: normal;
}
footer {
  margin-top: 1.5rem;
  color: var(--muted);
  font-size: .85rem;
}
@media (max-width: 760px) {
  main { width: min(100% - 1rem, 1120px); padding-top: 2rem; }
  .summary-grid, .metric-grid, .meta-grid { grid-template-columns: 1fr; }
  .metric-grid div { border-right: 0; border-bottom: 1px solid var(--border); }
  .metric-grid div:last-child { border-bottom: 0; }
  .section-heading { display: block; }
  .result-callout { min-width: 0; text-align: left; margin-top: .75rem; }
}
</style>
</head>
<body>
<main>
  <header class="hero">
    <p class="eyebrow">Performance report</p>
    <h1>oxdg benchmark</h1>
    <p>Dependency-graph performance on a pinned ${escapeHtml(corpus.name)} corpus. Results are measurements from this runner, not universal performance claims.</p>
    <div class="hero-meta">
      <span>Corpus <code>${escapeHtml(corpus.commit.slice(0, 12))}</code></span>
      <span>Generated ${escapeHtml(generatedAt)}</span>
      <span>Node ${escapeHtml(environment.runtimes.node.actual)}</span>
    </div>
  </header>

  <section class="summary-grid" aria-label="Benchmark summary">
    <div class="summary-card">
      <span>Directory-wide</span>
      <strong>${formatDuration(workloads.directory.results.oxdg.meanMs)}</strong>
      <p>${escapeHtml(comparisonText(workloads.directory))}</p>
    </div>
    <div class="summary-card">
      <span>Entrypoint</span>
      <strong>${formatDuration(workloads.entrypoint.results.oxdg.meanMs)}</strong>
      <p>${escapeHtml(comparisonText(workloads.entrypoint))}</p>
    </div>
    <div class="summary-card">
      <span>Source files</span>
      <strong>${workloads.directory.files ?? "—"}</strong>
      <p>Directory-wide workload</p>
    </div>
  </section>

  ${workloadTable(
    "Directory-wide analysis",
    `${workloads.directory.files ?? "All"} source files under ${workloads.directory.input}; extensions: ${workloads.directory.extensions.join(", ")}.`,
    workloads.directory,
  )}

  ${workloadTable(
    "Entrypoint analysis",
    `Single entrypoint at ${workloads.entrypoint.input}; extensions: ${workloads.entrypoint.extensions.join(", ")}.`,
    workloads.entrypoint,
  )}

  ${packageSection}

  <details class="panel">
    <summary>Methodology and environment</summary>
    <div class="details-body">
      <div class="meta-grid">
        <div><span>Runner</span><strong>${escapeHtml(environment.runner.label)}</strong></div>
        <div><span>Runner image</span><strong>${escapeHtml(runnerImage)}</strong></div>
        <div><span>CPU</span><strong>${escapeHtml(cpuDetails(environment.host.cpu))}</strong></div>
        <div><span>Host</span><strong>${escapeHtml(environment.host.uname)}</strong></div>
        <div><span>oxdg</span><strong>${escapeHtml(environment.tools.oxdg.version)} · ${escapeHtml(environment.tools.oxdg.gitCommit.slice(0, 12))}</strong></div>
        <div><span>Comparison tools</span><strong>dpdm ${escapeHtml(environment.tools.dpdm.version)} · Madge ${escapeHtml(environment.tools.madge.version)}</strong></div>
        <div><span>Runtimes</span><strong>Node ${escapeHtml(environment.runtimes.node.actual)} · Bun ${escapeHtml(environment.runtimes.bun.actual)} · npm ${escapeHtml(environment.runtimes.npm)}</strong></div>
        <div><span>Sampling</span><strong>${benchmark.warmup} warmups · ${benchmark.runs} measured runs</strong></div>
      </div>
      ${commandList("directory")}
      ${commandList("entrypoint")}
    </div>
  </details>

  <footer>
    <a href="latest.json">Normalized JSON</a>
    ${environment.runner.workflowRunId ? ` · Workflow run ${escapeHtml(environment.runner.workflowRunId)}` : ""}
  </footer>
</main>
</body>
</html>
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
