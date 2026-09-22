import { graphlib, layout } from "@dagrejs/dagre";
import type { ModuleGraph } from "../types.js";

export interface SvgRenderOptions {
  direction?: "LR" | "TB";
}

interface LayoutEdge {
  from: string;
  to: string;
}

const MIN_NODE_WIDTH = 120;
const MAX_NODE_WIDTH = 420;
const NODE_HEIGHT = 36;
const GRAPH_MARGIN = 24;

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&apos;")
    .replaceAll("\n", "&#10;");
}

function nodeWidth(label: string): number {
  return Math.min(MAX_NODE_WIDTH, Math.max(MIN_NODE_WIDTH, label.length * 8 + 24));
}

function edgeKey(from: string, to: string): string {
  return `${from}\u0000${to}`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function pathForPoints(points: readonly { x: number; y: number }[]): string {
  if (points.length === 0) {
    return "";
  }

  const [first, ...rest] = points;
  if (!first) {
    return "";
  }

  return [
    `M ${formatNumber(first.x)} ${formatNumber(first.y)}`,
    ...rest.map((point) => `L ${formatNumber(point.x)} ${formatNumber(point.y)}`),
  ].join(" ");
}

export function renderSvg(graph: ModuleGraph, options: SvgRenderOptions = {}): string {
  const direction = options.direction ?? "LR";
  const modules = [...graph.nodes.keys()].sort(compareStrings);
  const ids = new Map(modules.map((module, index) => [module, `n${index}`]));
  const dagreGraph = new graphlib.Graph({ directed: true });
  dagreGraph.setGraph({
    rankdir: direction,
    marginx: GRAPH_MARGIN,
    marginy: GRAPH_MARGIN,
  });
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  for (const module of modules) {
    const id = ids.get(module);
    if (id) {
      dagreGraph.setNode(id, {
        width: nodeWidth(module),
        height: NODE_HEIGHT,
      });
    }
  }

  const layoutEdges: LayoutEdge[] = [];
  const seenEdges = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.status !== "internal" || edge.to === undefined) {
      continue;
    }
    const from = ids.get(edge.from);
    const to = ids.get(edge.to);
    if (!from || !to) {
      continue;
    }
    const key = edgeKey(from, to);
    if (seenEdges.has(key)) {
      continue;
    }
    seenEdges.add(key);
    layoutEdges.push({ from, to });
    dagreGraph.setEdge(from, to);
  }

  layout(dagreGraph);

  const label = dagreGraph.graph();
  const width = Math.max(1, Math.ceil(label.width ?? 0));
  const height = Math.max(1, Math.ceil(label.height ?? 0));
  const elements: string[] = [];

  for (const edge of layoutEdges) {
    const points = dagreGraph.edge({ v: edge.from, w: edge.to }).points;
    const path = pathForPoints(points);
    if (path) {
      elements.push(
        `<path d="${path}" fill="none" stroke="#64748b" stroke-width="1.5" marker-end="url(#arrow)"/>`,
      );
    }
  }

  for (const module of modules) {
    const id = ids.get(module);
    if (!id) {
      continue;
    }
    const node = dagreGraph.node(id);
    const x = node.x - node.width / 2;
    const y = node.y - node.height / 2;
    elements.push(
      `<rect x="${formatNumber(x)}" y="${formatNumber(y)}" width="${formatNumber(node.width)}" height="${formatNumber(node.height)}" rx="4" fill="#ffffff" stroke="#334155"/>`,
    );
    elements.push(
      `<text x="${formatNumber(x + 12)}" y="${formatNumber(node.y)}" fill="#0f172a" font-family="sans-serif" font-size="14" dominant-baseline="middle">${escapeXml(module)}</text>`,
    );
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    "  <defs>",
    '    <marker id="arrow" viewBox="0 0 10 7" refX="9" refY="3.5" markerWidth="10" markerHeight="7" orient="auto">',
    '      <path d="M 0 0 L 10 3.5 L 0 7 Z" fill="#64748b"/>',
    "    </marker>",
    "  </defs>",
    ...elements.map((element) => `  ${element}`),
    "</svg>",
  ].join("\n");
}
