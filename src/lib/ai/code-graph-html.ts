import fs from "node:fs/promises";
import path from "node:path";
import type { ProjectIndex } from "@/lib/ai/code-evidence";

const MERMAID_PATH = path.join(
  path.resolve("node_modules", "mermaid", "dist"),
  "mermaid.min.js"
);

let mermaidCache: string | null = null;

async function readMermaidSource(): Promise<string> {
  if (mermaidCache !== null) return mermaidCache;
  const raw = await fs.readFile(MERMAID_PATH, "utf8").catch(() => "");
  // 读不到时回落到 CDN，但保留离线优先。读到了就缓存复用。
  mermaidCache = raw || "/* mermaid.min.js 未找到，请检查依赖安装 */";
  return mermaidCache;
}

/** 把任意字符串转换为合法的 mermaid 节点 id（字母数字下划线）。 */
function safeId(prefix: string, value: string) {
  const cleaned = value
    .replaceAll("\\", "/")
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return `${prefix}_${cleaned || "root"}`;
}

/** 转义 mermaid 节点标签里的危险字符（用于 ["..."] 包裹形式）。 */
function escapeLabel(value: string) {
  return value.replaceAll("\\", "/").replaceAll('"', "'").replaceAll("[", "(").replaceAll("]", ")");
}

/** 取路径的顶层目录前缀（如 src/lib/ai/x.ts → src/lib）。 */
function topDir(relativePath: string, depth = 2) {
  const parts = relativePath.split("/").filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? "(root)";
  return parts.slice(0, Math.min(depth, parts.length - 1)).join("/");
}

function shortenLabel(value: string, max = 40) {
  const clean = value.replaceAll("\\", "/");
  return clean.length > max ? `…${clean.slice(-max + 1)}` : clean;
}

const MAX_MODULE_NODES = 60;
const MAX_MODULE_EDGES = 120;
const MAX_SUBGRAPH_NODES = 80;
const MAX_SUBGRAPH_EDGES = 100;
const MAX_TOP_DIRS = 12;

interface ModuleGraph {
  nodes: Map<string, string>;
  edges: Map<string, number>;
}

/** 构造模块依赖图：把 imports 边按顶层目录聚合。 */
function buildModuleGraph(index: ProjectIndex): ModuleGraph {
  const nodes = new Map<string, string>();
  const edges = new Map<string, number>();
  const addNode = (key: string) => {
    if (!nodes.has(key)) nodes.set(key, safeId("m", key));
  };
  for (const edge of index.edges) {
    if (edge.kind !== "imports") continue;
    const from = topDir(edge.from);
    const to = topDir(edge.to);
    if (!from || !to || from === to) continue;
    addNode(from);
    addNode(to);
    const key = `${from}→${to}`;
    edges.set(key, (edges.get(key) ?? 0) + 1);
  }
  return { nodes, edges };
}

function moduleGraphToMermaid(graph: ModuleGraph): string {
  if (graph.nodes.size === 0) {
    return "flowchart TD\n  empty[\"未检出 imports 依赖\"]\n";
  }
  const nodeKeys = [...graph.nodes.keys()];
  // 节点过多时只保留度数最高的 Top N，避免 mermaid 渲染卡死。
  const degree = new Map<string, number>();
  for (const key of graph.edges.keys()) {
    const [from, to] = key.split("→");
    degree.set(from, (degree.get(from) ?? 0) + 1);
    degree.set(to, (degree.get(to) ?? 0) + 1);
  }
  const kept = (nodeKeys.length > MAX_MODULE_NODES
    ? nodeKeys
        .map((k) => ({ k, d: degree.get(k) ?? 0 }))
        .sort((a, b) => b.d - a.d)
        .slice(0, MAX_MODULE_NODES)
        .map((x) => x.k)
    : nodeKeys
  ).sort();
  const keptSet = new Set(kept);

  const lines: string[] = ["flowchart TD"];
  for (const key of kept) {
    lines.push(`  ${graph.nodes.get(key)}["${escapeLabel(shortenLabel(key))}"]`);
  }
  const edgeEntries = [...graph.edges.entries()]
    .filter(([key]) => {
      const [from, to] = key.split("→");
      return keptSet.has(from) && keptSet.has(to);
    })
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_MODULE_EDGES);
  for (const [key, weight] of edgeEntries) {
    const [from, to] = key.split("→");
    const label = weight > 1 ? `|${weight}|` : "";
    lines.push(`  ${graph.nodes.get(from)} -->${label} ${graph.nodes.get(to)}`);
  }
  if (nodeKeys.length > MAX_MODULE_NODES) {
    lines.push(`  more[\"...另有 ${nodeKeys.length - MAX_MODULE_NODES} 个模块已折叠\"]`);
    lines.push(`  style more fill:#f5f5f5,stroke:#ccc,stroke-dasharray:4 3`);
  }
  return lines.join("\n");
}

/** 按顶层目录分桶的调用子图。返回 dir → mermaid 源码。 */
function buildCallSubgraphs(index: ProjectIndex): Map<string, string> {
  const byDir = new Map<string, { from: string; to: string }[]>();
  for (const edge of index.edges) {
    if (edge.kind !== "calls") continue;
    const dir = topDir(edge.evidence.path);
    const list = byDir.get(dir) ?? [];
    list.push({ from: edge.from, to: edge.to });
    byDir.set(dir, list);
  }
  const result = new Map<string, string>();
  const sortedDirs = [...byDir.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, MAX_TOP_DIRS);
  for (const [dir, list] of sortedDirs) {
    const nodeIds = new Map<string, string>();
    const addNode = (raw: string) => {
      if (!nodeIds.has(raw)) nodeIds.set(raw, safeId("c", `${dir}/${raw}`));
      return nodeIds.get(raw)!;
    };
    const lines: string[] = ["flowchart TD"];
    const edges = list.slice(0, MAX_SUBGRAPH_EDGES);
    for (const { from, to } of edges) {
      addNode(from);
      addNode(to);
    }
    for (const [raw, id] of [...nodeIds.entries()].slice(0, MAX_SUBGRAPH_NODES)) {
      lines.push(`  ${id}["${escapeLabel(shortenLabel(raw.split("#").pop() ?? raw, 32))}"]`);
    }
    for (const { from, to } of edges) {
      lines.push(`  ${nodeIds.get(from)} --> ${nodeIds.get(to)}`);
    }
    if (list.length > MAX_SUBGRAPH_EDGES) {
      lines.push(`  more_${safeId("c", dir)}["...另有 ${list.length - MAX_SUBGRAPH_EDGES} 条调用"]`);
    }
    result.set(dir, lines.join("\n"));
  }
  return result;
}

/** 生成自包含 HTML：内联 mermaid 11.x，离线可用。 */
export async function generateGraphHtml(index: ProjectIndex): Promise<string> {
  const mermaidSource = await readMermaidSource();
  const moduleGraph = buildModuleGraph(index);
  const moduleMermaid = moduleGraphToMermaid(moduleGraph);
  const subgraphs = buildCallSubgraphs(index);

  const totalCalls = index.edges.filter((e) => e.kind === "calls").length;
  const totalImports = index.edges.filter((e) => e.kind === "imports").length;

  const escapedProjectId = escapeHtml(index.projectId);
  const escapedRoot = escapeHtml(index.root);

  const subgraphSections = [...subgraphs.entries()]
    .map(([dir, source], i) => {
      const safe = escapeHtml(dir);
      const encoded = escapeMermaidBlock(source);
      const callCount = source.split("\n").filter((l) => l.includes("-->")).length;
      return `      <details class="subgraph-block"${i < 3 ? " open" : ""}>
        <summary class="subgraph-title">${safe} <span class="muted">(${callCount} calls)</span></summary>
        <pre class="mermaid">${encoded}</pre>
      </details>`;
    })
    .join("\n");

  // 精简数据嵌入：避免把完整大图谱塞进 HTML 造成体积爆炸。
  const slimData = {
    projectId: index.projectId,
    snapshotHash: index.snapshotHash,
    generatedAt: index.generatedAt,
    files: index.files.length,
    symbols: index.symbols.length,
    edges: index.edges.length,
    edgeBreakdown: {
      calls: totalCalls,
      imports: totalImports,
    },
  };

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>代码图谱 · ${escapedProjectId}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px;
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
    color: #1f2937; background: #fafafa;
    line-height: 1.6;
  }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 28px 0 12px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; }
  .muted { color: #6b7280; font-weight: 400; font-size: 12px; }
  .stats { display: flex; flex-wrap: wrap; gap: 12px; margin: 12px 0 8px; }
  .stat { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px 14px; }
  .stat b { font-size: 18px; display: block; }
  .stat span { font-size: 11px; color: #6b7280; }
  .graph-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px; overflow-x: auto; }
  .subgraph-block { margin: 10px 0; border: 1px solid #e5e7eb; border-radius: 8px; background: #fff; padding: 8px 12px; }
  .subgraph-title { cursor: pointer; font-weight: 600; font-size: 13px; padding: 4px 0; }
  .subgraph-block[open] .subgraph-title { margin-bottom: 8px; }
  pre.mermaid { background: transparent; text-align: center; margin: 8px 0; }
  @media (prefers-color-scheme: dark) {
    body { background: #0b0f17; color: #e5e7eb; }
    .stat, .graph-card, .subgraph-block { background: #111827; border-color: #1f2937; }
    h2 { border-color: #1f2937; }
  }
</style>
</head>
<body>
  <h1>代码图谱 · ${escapedProjectId}</h1>
  <p class="muted">${escapedRoot} · 快照 <code>${escapeHtml(index.snapshotHash.slice(0, 16))}</code> · ${escapeHtml(index.generatedAt)}</p>
  <div class="stats">
    <div class="stat"><b>${index.files.length}</b><span>文件</span></div>
    <div class="stat"><b>${index.symbols.length}</b><span>符号</span></div>
    <div class="stat"><b>${index.edges.length}</b><span>关系边</span></div>
    <div class="stat"><b>${totalImports}</b><span>imports</span></div>
    <div class="stat"><b>${totalCalls}</b><span>calls</span></div>
  </div>

  <h2>模块依赖图</h2>
  <div class="graph-card">
    <pre class="mermaid">${escapeMermaidBlock(moduleMermaid)}</pre>
  </div>

  <h2>目录调用子图</h2>
${subgraphSections || '  <p class="muted">未检出 calls 边。</p>'}

  <script type="application/json" id="graph-data">${escapeHtml(JSON.stringify(slimData))}</script>
  <script>
    ${mermaidSource}
  </script>
  <script>
    mermaid.initialize({ startOnLoad: true, securityLevel: "strict", theme: "neutral", flowchart: { useMaxWidth: true, htmlLabels: true, curve: "basis" } });
  </script>
</body>
</html>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** mermaid 源码放进 <pre> 内不需要 HTML 转义里尖括号的严格处理，但需要避免 </script> 与 &amp; 双重转义问题。 */
function escapeMermaidBlock(source: string) {
  // 仅转义会破坏 HTML 解析的字符；保留 mermaid 自己的语法。
  return source.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
