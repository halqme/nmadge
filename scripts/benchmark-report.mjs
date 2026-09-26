import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const competitorOrder = ["dpdm", "madge"];
const competitorLabels = { dpdm: "dpdm", madge: "Madge" };
const corpusOrder = ["hono", "webpack"];
const revisionOrder = ["release", "main"];

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

function formatRelative(ratio) {
  if (Math.abs(ratio - 1) < 0.005) return "1.00×";
  return ratio > 1 ? `${ratio.toFixed(2)}× slower` : `${(1 / ratio).toFixed(2)}× faster`;
}

function comparisonForOxdg(ratio, tool) {
  if (Math.abs(ratio - 1) < 0.005) return `at parity with ${competitorLabels[tool]}`;
  return ratio > 1
    ? `${ratio.toFixed(2)}× faster than ${competitorLabels[tool]}`
    : `${(1 / ratio).toFixed(2)}× slower than ${competitorLabels[tool]}`;
}

function formatDelta(percent) {
  if (Math.abs(percent) < 0.05) return "0.0%";
  return `${percent > 0 ? "+" : ""}${percent.toFixed(1)}%`;
}

function cpuDetails(cpu) {
  const entries = cpu?.lscpu ?? [];
  const field = (name) =>
    entries.find((entry) => entry.field?.replace(/:$/, "") === name)?.data ?? "unknown";
  return `${field("Model name")} (${field("CPU(s)")} logical CPUs)`;
}

function normalizeRawWorkload(raw, workload, label) {
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
  for (const tool of [...revisionOrder, ...competitorOrder]) {
    if (!results[tool]) throw new Error(`${label} benchmark results are missing ${tool}`);
  }
  return results;
}

function revisionWorkload(rawResults, workload, revisionKey) {
  const oxdg = rawResults[revisionKey];
  const relativePerformance = Object.fromEntries(
    competitorOrder.map((tool) => {
      const ratio = rawResults[tool].meanSeconds / oxdg.meanSeconds;
      return [tool, { ratioToOxdg: ratio, label: formatRelative(ratio) }];
    }),
  );

  return {
    input: workload.input,
    extensions: workload.extensions,
    ...(workload.files === undefined ? {} : { files: workload.files }),
    commands: {
      oxdg: workload.commands[revisionKey],
      dpdm: workload.commands.dpdm,
      madge: workload.commands.madge,
    },
    results: {
      oxdg,
      dpdm: rawResults.dpdm,
      madge: rawResults.madge,
    },
    relativePerformance,
  };
}

function normalizeCorpus(key, metadata, raw, revisionKey) {
  const corpus = metadata.corpora?.[key];
  if (!corpus) throw new Error(`benchmark metadata is missing corpus: ${key}`);
  const directoryResults = normalizeRawWorkload(
    raw.directory,
    corpus.workloads.directory,
    `${key} directory`,
  );
  const entrypointResults = normalizeRawWorkload(
    raw.entrypoint,
    corpus.workloads.entrypoint,
    `${key} entrypoint`,
  );

  return {
    name: corpus.name,
    profile: corpus.profile,
    repository: corpus.repository,
    commit: corpus.commit,
    workloads: {
      directory: revisionWorkload(directoryResults, corpus.workloads.directory, revisionKey),
      entrypoint: revisionWorkload(entrypointResults, corpus.workloads.entrypoint, revisionKey),
    },
  };
}

function revisionReport(metadata, raw, revisionKey, generatedAt) {
  const revision = metadata.revisions?.[revisionKey];
  if (!revision) throw new Error(`benchmark metadata is missing revision: ${revisionKey}`);
  return {
    generatedAt,
    revision: {
      key: revisionKey,
      label: revision.label,
      source: revision.source,
      version: revision.version,
      ...(revision.gitCommit ? { gitCommit: revision.gitCommit } : {}),
    },
    environment: {
      runner: metadata.runner,
      host: metadata.host,
      tools: {
        oxdg: {
          version: revision.version,
          ...(revision.gitCommit ? { gitCommit: revision.gitCommit } : {}),
        },
        madge: metadata.tools.madge,
        dpdm: metadata.tools.dpdm,
      },
      runtimes: metadata.runtimes,
    },
    benchmark: metadata.benchmark,
    packageFootprint: revision.packageFootprint,
    corpora: Object.fromEntries(
      corpusOrder.map((key) => [key, normalizeCorpus(key, metadata, raw[key], revisionKey)]),
    ),
  };
}

function comparisonReport(release, main) {
  return Object.fromEntries(
    corpusOrder.map((key) => {
      const workloads = {};
      for (const workloadKey of ["directory", "entrypoint"]) {
        const releaseMs = release.corpora[key].workloads[workloadKey].results.oxdg.meanMs;
        const mainMs = main.corpora[key].workloads[workloadKey].results.oxdg.meanMs;
        workloads[workloadKey] = {
          releaseMs,
          mainMs,
          deltaPercent: ((mainMs - releaseMs) / releaseMs) * 100,
          speedup: releaseMs / mainMs,
        };
      }
      return [key, workloads];
    }),
  );
}

function workloadTableMarkdown(workload) {
  return [
    "| Tool | Mean | Stddev | Median | Min | Max | Relative |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...["oxdg", ...competitorOrder].map((tool) => {
      const result = workload.results[tool];
      const relative = tool === "oxdg" ? "1.00×" : workload.relativePerformance[tool].label;
      const label = tool === "oxdg" ? "oxdg" : competitorLabels[tool];
      return `| ${label} | ${formatDuration(result.meanMs)} | ${formatDuration(result.stddevMs)} | ${formatDuration(result.medianMs)} | ${formatDuration(result.minMs)} | ${formatDuration(result.maxMs)} | ${relative} |`;
    }),
  ];
}

function makeMarkdown(release, main, comparison) {
  const lines = [
    "# Benchmark",
    "",
    "The released npm package is the stable benchmark. Development results from main are measured in the same hyperfine runs for direct comparison.",
    "",
    `## Released — oxdg v${release.revision.version}`,
    "",
  ];

  for (const key of corpusOrder) {
    const corpus = release.corpora[key];
    lines.push(
      `### ${corpus.name} — ${corpus.profile}`,
      "",
      `- **Directory-wide:** ${formatDuration(corpus.workloads.directory.results.oxdg.meanMs)}`,
      `- **Entrypoint:** ${formatDuration(corpus.workloads.entrypoint.results.oxdg.meanMs)}`,
      "",
      ...workloadTableMarkdown(corpus.workloads.directory),
      "",
    );
  }

  lines.push(
    `## Development — main @ ${main.revision.gitCommit.slice(0, 12)}`,
    "",
    "### Since latest release",
    "",
    "| Corpus | Workload | Released | Main | Δ |",
    "| --- | --- | ---: | ---: | ---: |",
  );
  for (const key of corpusOrder) {
    for (const workloadKey of ["directory", "entrypoint"]) {
      const item = comparison[key][workloadKey];
      lines.push(
        `| ${main.corpora[key].name} | ${workloadKey === "directory" ? "Directory-wide" : "Entrypoint"} | ${formatDuration(item.releaseMs)} | ${formatDuration(item.mainMs)} | ${formatDelta(item.deltaPercent)} |`,
      );
    }
  }

  for (const key of corpusOrder) {
    const corpus = main.corpora[key];
    lines.push(
      "",
      `### ${corpus.name} — ${corpus.profile}`,
      "",
      ...workloadTableMarkdown(corpus.workloads.directory),
    );
  }

  lines.push(
    "",
    "## Package footprint",
    "",
    "| Revision | Packed | Unpacked | Installed node_modules |",
    "| --- | ---: | ---: | ---: |",
    `| Released v${release.revision.version} | ${formatBytes(release.packageFootprint.packedSizeBytes)} | ${formatBytes(release.packageFootprint.unpackedSizeBytes)} | ${formatBytes(release.packageFootprint.nodeModulesSizeBytes)} |`,
    `| Main | ${formatBytes(main.packageFootprint.packedSizeBytes)} | ${formatBytes(main.packageFootprint.unpackedSizeBytes)} | ${formatBytes(main.packageFootprint.nodeModulesSizeBytes)} |`,
    "",
    "## Environment",
    "",
    `- Runner: ${release.environment.runner.label}`,
    `- CPU: ${cpuDetails(release.environment.host.cpu)}`,
    `- Node.js: ${release.environment.runtimes.node.actual}`,
    `- hyperfine: ${release.benchmark.warmup} warmups, ${release.benchmark.runs} measured runs`,
    "",
  );
  return lines.join("\n");
}

function revisionSection(report, id, eyebrow) {
  const workloadTable = (workload) => {
    const rows = ["oxdg", ...competitorOrder]
      .map((tool) => {
        const result = workload.results[tool];
        const label = tool === "oxdg" ? "oxdg" : competitorLabels[tool];
        const relative = tool === "oxdg" ? "baseline" : workload.relativePerformance[tool].label;
        return `<tr class="${tool === "oxdg" ? "primary-row" : ""}">
          <th scope="row">${escapeHtml(label)}</th>
          <td>${formatDuration(result.meanMs)}</td>
          <td>± ${formatDuration(result.stddevMs)}</td>
          <td>${formatDuration(result.medianMs)}</td>
          <td>${formatDuration(result.minMs)}</td>
          <td>${formatDuration(result.maxMs)}</td>
          <td>${escapeHtml(relative)}</td>
        </tr>`;
      })
      .join("");
    return `<div class="table-wrap"><table>
      <thead><tr><th>Tool</th><th>Mean</th><th>Stddev</th><th>Median</th><th>Min</th><th>Max</th><th>Relative</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  };

  return `<section class="revision" id="${id}">
    <div class="revision-heading">
      <div><p class="eyebrow">${escapeHtml(eyebrow)}</p><h2>${escapeHtml(report.revision.label)}</h2>
      <p>${report.revision.gitCommit ? `Commit <code>${escapeHtml(report.revision.gitCommit.slice(0, 12))}</code>` : "Published npm package"}</p></div>
    </div>
    ${corpusOrder
      .map((key) => {
        const corpus = report.corpora[key];
        return `<article class="panel corpus-panel">
          <div class="corpus-heading"><div><p class="eyebrow">${escapeHtml(corpus.profile)}</p><h3>${escapeHtml(corpus.name)}</h3><p><code>${escapeHtml(corpus.commit.slice(0, 12))}</code></p></div>
          <div class="corpus-stats"><div><span>Directory</span><strong>${formatDuration(corpus.workloads.directory.results.oxdg.meanMs)}</strong></div><div><span>Entrypoint</span><strong>${formatDuration(corpus.workloads.entrypoint.results.oxdg.meanMs)}</strong></div></div></div>
          <div class="workload"><h4>Directory-wide analysis</h4>${workloadTable(corpus.workloads.directory)}</div>
          <div class="workload"><h4>Entrypoint analysis</h4>${workloadTable(corpus.workloads.entrypoint)}</div>
        </article>`;
      })
      .join("")}
  </section>`;
}

function makeHtml(release, main, comparison, generatedAt) {
  const sinceCards = corpusOrder
    .flatMap((key) =>
      ["directory", "entrypoint"].map((workloadKey) => {
        const item = comparison[key][workloadKey];
        const faster = item.deltaPercent < 0;
        return `<div class="delta-card"><span>${escapeHtml(main.corpora[key].name)} · ${workloadKey === "directory" ? "directory" : "entrypoint"}</span>
          <strong>${formatDelta(item.deltaPercent)}</strong>
          <small>${formatDuration(item.releaseMs)} → ${formatDuration(item.mainMs)}${faster ? ` · ${item.speedup.toFixed(2)}× as fast` : ""}</small></div>`;
      }),
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>oxdg benchmark</title>
<style>
:root{color-scheme:light dark;--bg:#f7f7f8;--surface:#fff;--soft:#f1f3f5;--text:#18181b;--muted:#666a73;--border:#dfe2e6;--accent:#315efb;--accent-soft:#eef2ff;font:16px/1.55 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
@media(prefers-color-scheme:dark){:root{--bg:#0d0f12;--surface:#15181d;--soft:#1c2026;--text:#f2f3f5;--muted:#a7adb7;--border:#2c323b;--accent:#8ca8ff;--accent-soft:#1c274a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text)}main{width:min(1120px,calc(100% - 2rem));margin:auto;padding:3.5rem 0 5rem}a{color:var(--accent)}code{font:.92em ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--soft);padding:.12rem .3rem;border-radius:.3rem}
.hero h1{margin:0;font-size:clamp(2rem,5vw,3.4rem);line-height:1.05;letter-spacing:-.04em}.hero>p{max-width:780px;color:var(--muted);font-size:1.05rem}.eyebrow{margin:0;color:var(--accent)!important;font-size:.75rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.revision-nav{display:flex;gap:.6rem;margin:1.4rem 0 2rem}.revision-nav a{text-decoration:none;padding:.55rem .8rem;border:1px solid var(--border);border-radius:.55rem;background:var(--surface)}
.overview,.delta-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.8rem;margin:1.4rem 0}.overview-card,.delta-card,.panel{background:var(--surface);border:1px solid var(--border);border-radius:.9rem}.overview-card,.delta-card{padding:1rem}.overview-card span,.delta-card span,.delta-card small{display:block;color:var(--muted)}.overview-card strong,.delta-card strong{display:block;font-size:1.5rem;margin:.15rem 0}
.revision{margin-top:3rem}.revision-heading{margin-bottom:1rem}.revision-heading h2{margin:.15rem 0;font-size:2rem}.revision-heading p{color:var(--muted)}
.panel{margin:1rem 0;padding:1.25rem}.corpus-heading{display:flex;justify-content:space-between;gap:2rem;align-items:flex-start;padding-bottom:1rem;border-bottom:1px solid var(--border)}.corpus-heading h3{margin:.05rem 0 .25rem;font-size:1.35rem}.corpus-heading p{margin:0;color:var(--muted)}
.corpus-stats{display:flex;gap:1rem}.corpus-stats div{text-align:right}.corpus-stats span{display:block;color:var(--muted);font-size:.8rem}.corpus-stats strong{font-size:1.2rem}.workload{padding-top:1rem}.workload h4{margin:.2rem 0 .7rem}
.table-wrap{overflow-x:auto;border:1px solid var(--border);border-radius:.65rem}table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;white-space:nowrap}th,td{padding:.65rem .75rem;border-bottom:1px solid var(--border);text-align:right}th:first-child,td:first-child{text-align:left}thead th{background:var(--soft);color:var(--muted);font-size:.8rem}tbody tr:last-child th,tbody tr:last-child td{border-bottom:0}.primary-row{background:var(--accent-soft)}.primary-row th{color:var(--accent)}
.footprint-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.7rem}.footprint-grid>div{background:var(--soft);border-radius:.65rem;padding:.8rem}.footprint-grid span{display:block;color:var(--muted);font-size:.8rem}
details.panel summary{cursor:pointer;font-weight:650}footer{margin-top:1.5rem;color:var(--muted);font-size:.85rem}
@media(max-width:760px){main{width:min(100% - 1rem,1120px);padding-top:2rem}.overview,.delta-grid,.footprint-grid{grid-template-columns:1fr}.corpus-heading{display:block}.corpus-stats{margin-top:.8rem}.corpus-stats div{text-align:left}}
</style>
</head>
<body><main>
<header class="hero"><p class="eyebrow">Performance report</p><h1>oxdg benchmark</h1>
<p>The released npm package is the stable reference. Development main is measured in the same runs so upcoming performance changes remain visible without being presented as released performance.</p>
<div class="revision-nav"><a href="#released">Released v${escapeHtml(release.revision.version)}</a><a href="#development">Development main</a></div></header>

<section class="overview">
<div class="overview-card"><span>Released</span><strong>v${escapeHtml(release.revision.version)}</strong><small>npm package · stable benchmark</small></div>
<div class="overview-card"><span>Development</span><strong>${escapeHtml(main.revision.gitCommit.slice(0, 12))}</strong><small>main commit · same runner</small></div>
</section>

<section><p class="eyebrow">Development vs released</p><h2>Since latest release</h2><div class="delta-grid">${sinceCards}</div></section>

${revisionSection(release, "released", "Stable")}
${revisionSection(main, "development", "Development")}

<section class="panel"><p class="eyebrow">Package</p><h2>Footprint</h2>
<div class="footprint-grid">
<div><span>Released v${escapeHtml(release.revision.version)}</span><strong>${formatBytes(release.packageFootprint.unpackedSizeBytes)}</strong><small>unpacked · ${formatBytes(release.packageFootprint.packedSizeBytes)} packed · ${formatBytes(release.packageFootprint.nodeModulesSizeBytes)} installed</small></div>
<div><span>Main</span><strong>${formatBytes(main.packageFootprint.unpackedSizeBytes)}</strong><small>unpacked · ${formatBytes(main.packageFootprint.packedSizeBytes)} packed · ${formatBytes(main.packageFootprint.nodeModulesSizeBytes)} installed</small></div>
</div></section>

<details class="panel"><summary>Methodology and environment</summary>
<p>Released oxdg, main oxdg, dpdm, and Madge are executed in the same hyperfine runs against pinned Hono and Webpack corpora.</p>
<p>Runner: ${escapeHtml(release.environment.runner.label)} · CPU: ${escapeHtml(cpuDetails(release.environment.host.cpu))} · Node ${escapeHtml(release.environment.runtimes.node.actual)} · ${release.benchmark.warmup} warmups / ${release.benchmark.runs} measured runs.</p>
<p>Generated ${escapeHtml(generatedAt)}.</p></details>
<footer><a href="release.json">Released JSON</a> · <a href="main.json">Main JSON</a> · <a href="latest.json">Combined JSON</a></footer>
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

const generatedAt = new Date().toISOString();
const release = revisionReport(metadata, raw, "release", generatedAt);
const main = revisionReport(metadata, raw, "main", generatedAt);
const comparison = comparisonReport(release, main);
const combined = {
  schemaVersion: 2,
  generatedAt,
  release,
  main,
  sinceRelease: comparison,
};

const outputDirectory = resolve(optionValue("--output") ?? "benchmark-report");
const summaryPath = optionValue("--summary")
  ? resolve(optionValue("--summary"))
  : process.env.GITHUB_STEP_SUMMARY;
const summary = makeMarkdown(release, main, comparison);

const releaseHono = release.corpora.hono.workloads.directory;
const releaseWebpack = release.corpora.webpack.workloads.directory;
const mainHono = main.corpora.hono.workloads.directory;
const badges = {
  "runtime.json": {
    schemaVersion: 1,
    label: `Hono · oxdg v${release.revision.version}`,
    message: `${Math.round(releaseHono.results.oxdg.meanMs)} ms`,
    color: "blue",
  },
  "entrypoint.json": {
    schemaVersion: 1,
    label: `Hono entrypoint · v${release.revision.version}`,
    message: `${Math.round(release.corpora.hono.workloads.entrypoint.results.oxdg.meanMs)} ms`,
    color: "blue",
  },
  "vs-madge.json": {
    schemaVersion: 1,
    label: `Hono · v${release.revision.version} vs Madge`,
    message: `${releaseHono.relativePerformance.madge.ratioToOxdg.toFixed(2)}× faster`,
    color: "blue",
  },
  "webpack-runtime.json": {
    schemaVersion: 1,
    label: `Webpack · oxdg v${release.revision.version}`,
    message: `${Math.round(releaseWebpack.results.oxdg.meanMs)} ms`,
    color: "blue",
  },
  "main-runtime.json": {
    schemaVersion: 1,
    label: "Hono · oxdg main",
    message: `${Math.round(mainHono.results.oxdg.meanMs)} ms`,
    color: "blue",
  },
};

await mkdir(join(outputDirectory, "badges"), { recursive: true });
await Promise.all([
  writeFile(join(outputDirectory, "summary.md"), summary, "utf8"),
  writeFile(join(outputDirectory, "release.json"), `${JSON.stringify(release, null, 2)}\n`, "utf8"),
  writeFile(join(outputDirectory, "main.json"), `${JSON.stringify(main, null, 2)}\n`, "utf8"),
  writeFile(join(outputDirectory, "latest.json"), `${JSON.stringify(combined, null, 2)}\n`, "utf8"),
  writeFile(
    join(outputDirectory, "index.html"),
    makeHtml(release, main, comparison, generatedAt),
    "utf8",
  ),
  ...Object.entries(badges).map(([name, badge]) =>
    writeFile(join(outputDirectory, "badges", name), `${JSON.stringify(badge, null, 2)}\n`, "utf8"),
  ),
]);

if (summaryPath) {
  await mkdir(dirname(summaryPath), { recursive: true });
  await appendFile(summaryPath, `${summary}\n`, "utf8");
}

console.log(`Wrote benchmark report to ${outputDirectory}`);
