import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const toolOrder = ["oxdg", "dpdm", "madge"];
const toolLabels = { oxdg: "oxdg", dpdm: "dpdm", madge: "Madge" };
const corpusOrder = ["hono", "webpack"];

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requiredOption(name) {
  const value = optionValue(name);
  if (!value) throw new Error(`missing required option: ${name}`);
  return value;
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

function cpuDetails(cpu) {
  const entries = cpu?.lscpu ?? [];
  const field = (name) =>
    entries.find((entry) => entry.field?.replace(/:$/, "") === name)?.data ?? "unknown";
  return `${field("Model name")} (${field("CPU(s)")} logical CPUs)`;
}

function normalizeWorkload(raw, workload, label) {
  if (!workload?.commands) throw new Error(`benchmark metadata is missing ${label} commands`);
  const commandToTool = new Map(
    Object.entries(workload.commands).map(([tool, command]) => [command, tool]),
  );
  const results = {};
  for (const item of raw.results ?? []) {
    const tool = commandToTool.get(item.command);
    if (!tool) throw new Error(`unrecognized ${label} benchmark command: ${item.command}`);
    for (const key of ["mean", "stddev", "median", "min", "max"]) {
      if (typeof item[key] !== "number" || !Number.isFinite(item[key])) {
        throw new Error(`hyperfine result for ${label} ${tool} is missing numeric ${key}`);
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
    if (!results[tool]) throw new Error(`${label} benchmark results are missing ${tool}`);
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

function normalizeCorpus(key, metadata, raw) {
  const corpus = metadata.corpora?.[key];
  if (!corpus) throw new Error(`benchmark metadata is missing corpus: ${key}`);
  return {
    name: corpus.name,
    profile: corpus.profile,
    repository: corpus.repository,
    commit: corpus.commit,
    workloads: {
      directory: normalizeWorkload(raw.directory, corpus.workloads.directory, `${key} directory`),
      entrypoint: normalizeWorkload(
        raw.entrypoint,
        corpus.workloads.entrypoint,
        `${key} entrypoint`,
      ),
    },
  };
}

function workloadTableMarkdown(workload) {
  return [
    "| Tool | Mean | Stddev | Median | Min | Max | Relative |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...toolOrder.map((tool) => {
      const result = workload.results[tool];
      const relative = tool === "oxdg" ? "1.00×" : workload.relativePerformance[tool].label;
      return `| ${toolLabels[tool]} | ${formatDuration(result.meanMs)} | ${formatDuration(result.stddevMs)} | ${formatDuration(result.medianMs)} | ${formatDuration(result.minMs)} | ${formatDuration(result.maxMs)} | ${relative} |`;
    }),
  ];
}

function makeMarkdown(report) {
  const lines = [
    "# Benchmark",
    "",
    "Pinned ESM/TypeScript and CommonJS/JavaScript corpora are measured on the same runner.",
    "",
  ];

  for (const key of corpusOrder) {
    const corpus = report.corpora[key];
    const directory = corpus.workloads.directory;
    const entrypoint = corpus.workloads.entrypoint;
    const summary = (workload) =>
      ["dpdm", "madge"]
        .map((tool) => comparisonForOxdg(workload.relativePerformance[tool].ratioToOxdg, tool))
        .join(", ");

    lines.push(
      `## ${corpus.name} — ${corpus.profile}`,
      "",
      `Corpus commit: \`${corpus.commit}\``,
      `- **Directory-wide:** ${formatDuration(directory.results.oxdg.meanMs)} (${summary(directory)})`,
      `- **Entrypoint:** ${formatDuration(entrypoint.results.oxdg.meanMs)} (${summary(entrypoint)})`,
      "",
      "### Directory-wide analysis",
      "",
      ...workloadTableMarkdown(directory),
      "",
      "### Entrypoint analysis",
      "",
      ...workloadTableMarkdown(entrypoint),
      "",
      "### Input",
      "",
      "| Workload | Input | Extensions | Source files |",
      "| --- | --- | --- | ---: |",
      `| Directory-wide | \`${directory.input}\` | ${directory.extensions.join(", ")} | ${directory.files} |`,
      `| Entrypoint | \`${entrypoint.input}\` | ${entrypoint.extensions.join(", ")} | — |`,
      "",
    );
  }

  const { environment, benchmark, packageFootprint } = report;
  const image = `${environment.runner.imageOS} / ${environment.runner.imageVersion}`;
  lines.push(
    "## Environment",
    "",
    "| Property | Value |",
    "| --- | --- |",
    `| Runner | ${environment.runner.label} |`,
    `| Runner image | ${image} |`,
    `| CPU | ${cpuDetails(environment.host.cpu)} |`,
    `| Madge | ${environment.tools.madge.version} |`,
    `| dpdm | ${environment.tools.dpdm.version} |`,
    `| oxdg | ${environment.tools.oxdg.version} (Git \`${environment.tools.oxdg.gitCommit}\`) |`,
    `| Node.js | ${environment.runtimes.node.requested} (${environment.runtimes.node.actual}) |`,
    `| Bun | ${environment.runtimes.bun.requested} (${environment.runtimes.bun.actual}) |`,
    `| hyperfine | ${benchmark.warmup} warmups, ${benchmark.runs} measured runs |`,
    "",
    "## Package footprint",
    "",
    "| Metric | Value |",
    "| --- | ---: |",
    `| Packed package | ${formatBytes(packageFootprint.packedSizeBytes)} |`,
    `| Unpacked package | ${formatBytes(packageFootprint.unpackedSizeBytes)} |`,
    `| Installed node_modules | ${formatBytes(packageFootprint.nodeModulesSizeBytes)} |`,
    "",
  );
  return lines.join("\n");
}

function makeHtml(report) {
  const comparisonText = (workload) =>
    ["dpdm", "madge"]
      .map((tool) => comparisonForOxdg(workload.relativePerformance[tool].ratioToOxdg, tool))
      .join(" · ");

  const workloadTable = (title, workload) => {
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
    return `<div class="workload">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Workload</p>
          <h3>${escapeHtml(title)}</h3>
          <p><code>${escapeHtml(workload.input)}</code>${workload.files ? ` · ${workload.files} files` : ""}</p>
        </div>
        <div class="result-callout">
          <strong>${formatDuration(workload.results.oxdg.meanMs)}</strong>
          <span>${escapeHtml(comparisonText(workload))}</span>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Tool</th><th>Mean</th><th>Stddev</th><th>Median</th><th>Min</th><th>Max</th><th>Relative</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  };

  const corpusSection = (key) => {
    const corpus = report.corpora[key];
    return `<section class="panel corpus-panel">
      <div class="corpus-heading">
        <div>
          <p class="eyebrow">${escapeHtml(corpus.profile)}</p>
          <h2>${escapeHtml(corpus.name)}</h2>
          <p>Pinned at <code>${escapeHtml(corpus.commit.slice(0, 12))}</code></p>
        </div>
        <div class="corpus-stats">
          <div><span>Directory</span><strong>${formatDuration(corpus.workloads.directory.results.oxdg.meanMs)}</strong></div>
          <div><span>Entrypoint</span><strong>${formatDuration(corpus.workloads.entrypoint.results.oxdg.meanMs)}</strong></div>
        </div>
      </div>
      ${workloadTable("Directory-wide analysis", corpus.workloads.directory)}
      ${workloadTable("Entrypoint analysis", corpus.workloads.entrypoint)}
    </section>`;
  };

  const commandDetails = corpusOrder
    .map((key) => {
      const corpus = report.corpora[key];
      return `<div class="command-group">
        <h3>${escapeHtml(corpus.name)}</h3>
        <p>${escapeHtml(corpus.profile)} · <code>${escapeHtml(corpus.commit)}</code></p>
        ${["directory", "entrypoint"]
          .map((workloadKey) => {
            const workload = corpus.workloads[workloadKey];
            return `<h4>${workloadKey === "directory" ? "Directory-wide" : "Entrypoint"}</h4>
              <ul class="commands">
                ${toolOrder
                  .map(
                    (tool) =>
                      `<li><span>${escapeHtml(toolLabels[tool])}</span><code>${escapeHtml(workload.commands[tool])}</code></li>`,
                  )
                  .join("")}
              </ul>`;
          })
          .join("")}
      </div>`;
    })
    .join("");

  const { environment, benchmark, packageFootprint, generatedAt } = report;
  const runnerImage = `${environment.runner.imageOS} / ${environment.runner.imageVersion}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>oxdg benchmark</title>
<style>
:root {
  color-scheme: light dark;
  --bg:#f7f7f8;--surface:#fff;--surface-soft:#f1f3f5;--text:#18181b;
  --muted:#666a73;--border:#dfe2e6;--accent:#315efb;--accent-soft:#eef2ff;--code:#f4f4f5;
  font:16px/1.55 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
}
@media (prefers-color-scheme:dark){:root{--bg:#0d0f12;--surface:#15181d;--surface-soft:#1c2026;--text:#f2f3f5;--muted:#a7adb7;--border:#2c323b;--accent:#8ca8ff;--accent-soft:#1c274a;--code:#20242a}}
*{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--text)}
main{width:min(1120px,calc(100% - 2rem));margin:0 auto;padding:3.5rem 0 5rem}
a{color:var(--accent)} code{font:.92em ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--code);padding:.12rem .3rem;border-radius:.3rem}
.hero{margin-bottom:2rem}.hero h1{margin:0;font-size:clamp(2rem,5vw,3.4rem);line-height:1.05;letter-spacing:-.04em}
.hero>p{max-width:760px;margin:.85rem 0 0;color:var(--muted);font-size:1.05rem}
.hero-meta{display:flex;flex-wrap:wrap;gap:.5rem 1rem;margin-top:1rem;color:var(--muted);font-size:.9rem}
.overview-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.8rem;margin:2rem 0}
.overview-card,.panel{background:var(--surface);border:1px solid var(--border);border-radius:.9rem}
.overview-card{padding:1.1rem}.overview-card span{color:var(--muted);font-size:.8rem;text-transform:uppercase;letter-spacing:.06em}
.overview-card h2{margin:.2rem 0}.overview-metrics{display:grid;grid-template-columns:1fr 1fr;gap:.6rem;margin-top:.8rem}
.overview-metrics div{background:var(--surface-soft);padding:.7rem;border-radius:.55rem}.overview-metrics strong{display:block;font-size:1.2rem}
.panel{margin:1rem 0;padding:1.25rem}.corpus-heading,.section-heading{display:flex;justify-content:space-between;gap:2rem;align-items:flex-start}
.corpus-heading{padding-bottom:1rem;border-bottom:1px solid var(--border)}.corpus-heading h2,.section-heading h3{margin:.05rem 0 .25rem}
.corpus-heading p,.section-heading p{margin:0;color:var(--muted)}.eyebrow{margin:0;color:var(--accent)!important;font-size:.75rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.corpus-stats{display:flex;gap:1rem}.corpus-stats div{text-align:right}.corpus-stats span,.result-callout span{display:block;color:var(--muted);font-size:.8rem}.corpus-stats strong,.result-callout strong{display:block;font-size:1.2rem}
.workload{padding-top:1.25rem}.section-heading{margin-bottom:.8rem}.result-callout{text-align:right;min-width:210px}
.table-wrap{overflow-x:auto;border:1px solid var(--border);border-radius:.65rem}table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;white-space:nowrap}
th,td{padding:.65rem .75rem;border-bottom:1px solid var(--border);text-align:right}th:first-child,td:first-child{text-align:left}
thead th{background:var(--surface-soft);color:var(--muted);font-size:.8rem;font-weight:600}tbody tr:last-child th,tbody tr:last-child td{border-bottom:0}
.primary-row{background:var(--accent-soft)}.primary-row th{color:var(--accent)}
.metric-grid,.meta-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.55rem}
.metric-grid div,.meta-grid div{padding:.8rem;background:var(--surface-soft);border-radius:.55rem}.metric-grid span,.meta-grid span{display:block;color:var(--muted);font-size:.78rem}
details.panel summary{cursor:pointer;font-weight:650}.details-body{margin-top:1.2rem}.commands{padding:0;list-style:none}.commands li{display:grid;grid-template-columns:80px 1fr;gap:.75rem;margin:.4rem 0}.commands span{color:var(--muted)}.commands code{overflow-wrap:anywhere;white-space:normal}
footer{margin-top:1.5rem;color:var(--muted);font-size:.85rem}
@media(max-width:760px){main{width:min(100% - 1rem,1120px);padding-top:2rem}.overview-grid,.metric-grid,.meta-grid{grid-template-columns:1fr}.corpus-heading,.section-heading{display:block}.corpus-stats{margin-top:.8rem}.corpus-stats div,.result-callout{text-align:left}.result-callout{min-width:0;margin-top:.65rem}}
</style>
</head>
<body><main>
<header class="hero">
  <p class="eyebrow">Performance report</p>
  <h1>oxdg benchmark</h1>
  <p>Dependency-graph performance across pinned modern ESM/TypeScript and CommonJS/JavaScript corpora. Results are measurements from this runner, not universal performance claims.</p>
  <div class="hero-meta"><span>Generated ${escapeHtml(generatedAt)}</span><span>Node ${escapeHtml(environment.runtimes.node.actual)}</span><span>${benchmark.warmup} warmups · ${benchmark.runs} runs</span></div>
</header>
<section class="overview-grid" aria-label="Corpus overview">
${corpusOrder
  .map((key) => {
    const corpus = report.corpora[key];
    return `<div class="overview-card"><span>${escapeHtml(corpus.profile)}</span><h2>${escapeHtml(corpus.name)}</h2><div class="overview-metrics"><div><span>Directory</span><strong>${formatDuration(corpus.workloads.directory.results.oxdg.meanMs)}</strong></div><div><span>Entrypoint</span><strong>${formatDuration(corpus.workloads.entrypoint.results.oxdg.meanMs)}</strong></div></div></div>`;
  })
  .join("")}
</section>
${corpusOrder.map(corpusSection).join("")}
<section class="panel">
  <div class="section-heading"><div><p class="eyebrow">Package</p><h3>Footprint</h3></div><div class="result-callout"><strong>${formatBytes(packageFootprint.unpackedSizeBytes)}</strong><span>unpacked</span></div></div>
  <div class="metric-grid"><div><span>Packed</span><strong>${formatBytes(packageFootprint.packedSizeBytes)}</strong></div><div><span>Unpacked</span><strong>${formatBytes(packageFootprint.unpackedSizeBytes)}</strong></div><div><span>Installed node_modules</span><strong>${formatBytes(packageFootprint.nodeModulesSizeBytes)}</strong></div></div>
</section>
<details class="panel"><summary>Methodology and environment</summary><div class="details-body">
  <div class="meta-grid"><div><span>Runner</span><strong>${escapeHtml(environment.runner.label)}</strong></div><div><span>Runner image</span><strong>${escapeHtml(runnerImage)}</strong></div><div><span>CPU</span><strong>${escapeHtml(cpuDetails(environment.host.cpu))}</strong></div><div><span>oxdg</span><strong>${escapeHtml(environment.tools.oxdg.version)} · ${escapeHtml(environment.tools.oxdg.gitCommit.slice(0, 12))}</strong></div><div><span>Comparison tools</span><strong>dpdm ${escapeHtml(environment.tools.dpdm.version)} · Madge ${escapeHtml(environment.tools.madge.version)}</strong></div><div><span>Runtimes</span><strong>Node ${escapeHtml(environment.runtimes.node.actual)} · Bun ${escapeHtml(environment.runtimes.bun.actual)}</strong></div></div>
  ${commandDetails}
</div></details>
<footer><a href="latest.json">Normalized JSON</a>${environment.runner.workflowRunId ? ` · Workflow run ${escapeHtml(environment.runner.workflowRunId)}` : ""}</footer>
</main></body></html>`;
}

const metadata = JSON.parse(await readFile(resolve(requiredOption("--metadata")), "utf8"));
const raw = {
  hono: {
    directory: JSON.parse(await readFile(resolve(requiredOption("--hono-directory")), "utf8")),
    entrypoint: JSON.parse(await readFile(resolve(requiredOption("--hono-entrypoint")), "utf8")),
  },
  webpack: {
    directory: JSON.parse(await readFile(resolve(requiredOption("--webpack-directory")), "utf8")),
    entrypoint: JSON.parse(await readFile(resolve(requiredOption("--webpack-entrypoint")), "utf8")),
  },
};

const report = {
  generatedAt: new Date().toISOString(),
  environment: {
    runner: metadata.runner,
    host: metadata.host,
    tools: metadata.tools,
    runtimes: metadata.runtimes,
  },
  benchmark: metadata.benchmark,
  packageFootprint: metadata.packageFootprint,
  corpora: Object.fromEntries(
    corpusOrder.map((key) => [key, normalizeCorpus(key, metadata, raw[key])]),
  ),
};

const outputDirectory = resolve(optionValue("--output") ?? "benchmark-report");
const summaryPath = optionValue("--summary")
  ? resolve(optionValue("--summary"))
  : process.env.GITHUB_STEP_SUMMARY;
const summary = makeMarkdown(report);

const honoDirectory = report.corpora.hono.workloads.directory;
const honoEntrypoint = report.corpora.hono.workloads.entrypoint;
const webpackDirectory = report.corpora.webpack.workloads.directory;
const badges = {
  "runtime.json": {
    schemaVersion: 1,
    label: "Hono benchmark",
    message: `${Math.round(honoDirectory.results.oxdg.meanMs)} ms`,
    color: "blue",
  },
  "entrypoint.json": {
    schemaVersion: 1,
    label: "Hono entrypoint",
    message: `${Math.round(honoEntrypoint.results.oxdg.meanMs)} ms`,
    color: "blue",
  },
  "vs-madge.json": {
    schemaVersion: 1,
    label: "Hono vs Madge",
    message: `${honoDirectory.relativePerformance.madge.ratioToOxdg.toFixed(2)}× faster`,
    color: "blue",
  },
  "webpack-runtime.json": {
    schemaVersion: 1,
    label: "Webpack benchmark",
    message: `${Math.round(webpackDirectory.results.oxdg.meanMs)} ms`,
    color: "blue",
  },
};

await mkdir(join(outputDirectory, "badges"), { recursive: true });
await Promise.all([
  writeFile(join(outputDirectory, "summary.md"), summary, "utf8"),
  writeFile(join(outputDirectory, "latest.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8"),
  writeFile(join(outputDirectory, "index.html"), makeHtml(report), "utf8"),
  ...Object.entries(badges).map(([name, badge]) =>
    writeFile(join(outputDirectory, "badges", name), `${JSON.stringify(badge, null, 2)}\n`, "utf8"),
  ),
]);
if (summaryPath) {
  await mkdir(dirname(summaryPath), { recursive: true });
  await appendFile(summaryPath, `${summary}\n`, "utf8");
}
console.log(`Wrote benchmark report to ${outputDirectory}`);
