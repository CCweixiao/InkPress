import type { CodeRelation, ProjectIndex, SymbolEvidence } from "@/lib/ai/code-evidence";
import { modulesFromIndex } from "@/lib/ai/code-graph-analysis";

const ENTRY_NAME_PATTERN = /^(main|index|app|server|handler|route|controller)$/i;
const MAX_ENTRY_NODES = 10;
const MAX_HOTSPOTS = 20;
const MAX_DEPS = 20;
const MAX_CYCLES = 10;
const MAX_CYCLE_NODES = 12;

function sortByKind<T extends { kind: string }>(items: T[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([kind, count]) => ({ kind, count }));
}

/** 入口节点：名字命中常见入口关键字的符号。 */
function entryNodes(symbols: SymbolEvidence[]) {
  return symbols
    .filter((symbol) => ENTRY_NAME_PATTERN.test(symbol.name))
    .slice(0, MAX_ENTRY_NODES);
}

/**
 * 热点函数：按 calls 边的入度 + 出度排序端点。
 * 端点 id 形如 "path#name" 或 "name"，将其映射回最近一个同名符号作为展示锚点。
 */
function hotspots(index: ProjectIndex) {
  const calls = index.edges.filter((edge) => edge.kind === "calls");
  const degree = new Map<string, number>();
  for (const edge of calls) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }
  const byName = new Map<string, SymbolEvidence>();
  for (const symbol of index.symbols) {
    const key = `${symbol.path}#${symbol.name}`;
    if (!byName.has(key)) byName.set(key, symbol);
  }
  const ranked = [...degree.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_HOTSPOTS)
    .map(([node, deg]) => {
      const symbol = byName.get(node);
      const name = node.includes("#") ? node.slice(node.indexOf("#") + 1) : node;
      return {
        node,
        degree: deg,
        name,
        path: symbol?.path ?? node.split("#")[0] ?? "",
        line: symbol?.startLine ?? 1,
      };
    });
  return ranked;
}

/** 依赖矩阵：imports 边的 to 被引用次数 Top N。 */
function dependencyMatrix(edges: CodeRelation[]) {
  const counts = new Map<string, number>();
  for (const edge of edges) {
    if (edge.kind !== "imports") continue;
    counts.set(edge.to, (counts.get(edge.to) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_DEPS)
    .map(([target, count]) => ({ target, count }));
}

/**
 * 循环依赖：对 imports 边做 DFS 检测。
 * imports 边端点通常是文件路径或模块名，直接以节点字符串建邻接表。
 */
function detectCycles(edges: CodeRelation[]) {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.kind !== "imports") continue;
    if (!edge.from || !edge.to || edge.from === edge.to) continue;
    const list = adjacency.get(edge.from) ?? [];
    list.push(edge.to);
    adjacency.set(edge.from, list);
  }
  const cycles: string[][] = [];
  const found = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const onStack = new Set<string>();

  // 规范化签名：以环里字典序最小的节点为起点旋转，去重等价环。
  const signature = (cycle: string[]) => {
    const core = cycle.slice(0, -1);
    if (core.length === 0) return cycle.join("→");
    const minIdx = core.reduce(
      (min, cur, idx) => (cur < core[min] ? idx : min),
      0
    );
    return [...core.slice(minIdx), ...core.slice(0, minIdx)].join("→");
  };

  function dfs(node: string) {
    if (cycles.length >= MAX_CYCLES) return;
    if (onStack.has(node)) {
      const start = stack.indexOf(node);
      if (start >= 0) {
        const cycle = stack.slice(start).concat(node);
        const key = signature(cycle);
        if (!found.has(key) && cycle.length > 1) {
          found.add(key);
          cycles.push(cycle);
        }
      }
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    onStack.add(node);
    stack.push(node);
    const neighbors = adjacency.get(node);
    if (neighbors) {
      for (const next of neighbors) {
        if (cycles.length >= MAX_CYCLES) break;
        dfs(next);
      }
    }
    stack.pop();
    onStack.delete(node);
  }

  for (const node of adjacency.keys()) {
    if (cycles.length >= MAX_CYCLES) break;
    dfs(node);
  }
  return cycles;
}

/** 从 Markdown 报告生成代码图谱报告。 */
export function generateGraphReport(index: ProjectIndex): string {
  const symbolByKind = sortByKind(index.symbols);
  const edgeByKind = sortByKind(index.edges);
  const modules = modulesFromIndex(index);
  const entries = entryNodes(index.symbols);
  const hot = hotspots(index);
  const deps = dependencyMatrix(index.edges);
  const cycles = detectCycles(index.edges);

  const lines: string[] = [];
  lines.push(`# 代码图谱报告`);
  lines.push("");
  lines.push(`- 项目：${index.projectId}`);
  lines.push(`- 根目录：${index.root}`);
  lines.push(`- 快照哈希：\`${index.snapshotHash.slice(0, 16)}\``);
  lines.push(`- 生成时间：${index.generatedAt}`);
  lines.push(`- 构建模式：${index.buildMode ?? "fast"}`);
  if (index.truncated) {
    lines.push(`- ⚠ 索引已截断（部分符号/边可能缺失）`);
  }
  lines.push("");
  lines.push(`## 概览`);
  lines.push("");
  lines.push(`| 维度 | 数量 |`);
  lines.push(`| --- | ---: |`);
  lines.push(`| 文件 | ${index.files.length} |`);
  lines.push(`| 功能模块 | ${modules.length} |`);
  lines.push(`| 符号 | ${index.symbols.length} |`);
  lines.push(`| 关系边 | ${index.edges.length} |`);
  lines.push(`| 解析错误 | ${index.parseErrors.length} |`);
  lines.push("");
  lines.push(`### 语言分布`);
  lines.push("");
  const languageStats = index.languageStats ?? [];
  if (languageStats.length === 0) {
    lines.push(`_无语言统计_`);
  } else {
    lines.push(`| Language | 文件 | 字节 |`);
    lines.push(`| --- | ---: | ---: |`);
    for (const stat of languageStats) {
      lines.push(`| ${escapeCell(stat.language)} | ${stat.files} | ${stat.bytes} |`);
    }
  }
  lines.push("");
  lines.push(`## 功能模块分析`);
  lines.push("");
  if (modules.length === 0) {
    lines.push(`_未检出功能模块_`);
  } else {
    lines.push(`| 模块 | 文件 | 符号 | 入站 imports | 出站 imports | 职责推断 |`);
    lines.push(`| --- | ---: | ---: | ---: | ---: | --- |`);
    for (const graphModule of modules.slice(0, 30)) {
      lines.push(
        `| \`${escapeCell(graphModule.pathPrefix)}\` | ${graphModule.fileCount} | ${graphModule.symbolCount} | ${graphModule.inboundImports} | ${graphModule.outboundImports} | ${escapeCell(graphModule.responsibilities.join("；"))} |`
      );
    }
    lines.push("");
    lines.push(`### 模块依赖 Topology`);
    lines.push("");
    for (const graphModule of modules.filter((item) => item.dependencies.length > 0).slice(0, 20)) {
      const depsText = graphModule.dependencies
        .slice(0, 6)
        .map((dep) => `\`${escapeCell(dep.pathPrefix)}\`×${dep.count}`)
        .join("、");
      lines.push(`- \`${escapeCell(graphModule.pathPrefix)}\` → ${depsText}`);
    }
    if (!modules.some((item) => item.dependencies.length > 0)) {
      lines.push(`_未检出跨模块 imports 依赖_`);
    }
  }
  lines.push("");
  lines.push(`### 符号分布（按 kind）`);
  lines.push("");
  if (symbolByKind.length === 0) {
    lines.push(`_无符号_`);
  } else {
    lines.push(`| Kind | 数量 |`);
    lines.push(`| --- | ---: |`);
    for (const { kind, count } of symbolByKind) {
      lines.push(`| ${kind} | ${count} |`);
    }
  }
  lines.push("");
  lines.push(`### 关系分布（按 kind）`);
  lines.push("");
  if (edgeByKind.length === 0) {
    lines.push(`_无边_`);
  } else {
    lines.push(`| Kind | 数量 |`);
    lines.push(`| --- | ---: |`);
    for (const { kind, count } of edgeByKind) {
      lines.push(`| ${kind} | ${count} |`);
    }
  }
  lines.push("");
  lines.push(`## 入口节点`);
  lines.push("");
  if (entries.length === 0) {
    lines.push(`_未匹配到 main/index/app/server/handler/route/controller 命名的符号_`);
  } else {
    for (const symbol of entries) {
      lines.push(
        `- \`${symbol.path}#L${symbol.startLine}\` — **${symbol.name}**（${symbol.kind}）`
      );
    }
  }
  lines.push("");
  lines.push(`## 热点函数（按 calls 边入度+出度 Top ${MAX_HOTSPOTS}）`);
  lines.push("");
  if (hot.length === 0) {
    lines.push(`_未检出 calls 边_`);
  } else {
    lines.push(`| 度数 | 符号 | 位置 |`);
    lines.push(`| ---: | --- | --- |`);
    for (const item of hot) {
      lines.push(
        `| ${item.degree} | ${escapeCell(item.name)} | ${item.path ? `${item.path}#L${item.line}` : "—"} |`
      );
    }
  }
  lines.push("");
  lines.push(`## 依赖矩阵（被引用次数最多的模块 Top ${MAX_DEPS}）`);
  lines.push("");
  if (deps.length === 0) {
    lines.push(`_未检出 imports 边_`);
  } else {
    lines.push(`| 引用次数 | 模块/路径 |`);
    lines.push(`| ---: | --- |`);
    for (const { target, count } of deps) {
      lines.push(`| ${count} | \`${escapeCell(target)}\` |`);
    }
  }
  lines.push("");
  lines.push(`## 循环依赖（最多 ${MAX_CYCLES} 条，每条 ≤ ${MAX_CYCLE_NODES} 节点）`);
  lines.push("");
  if (cycles.length === 0) {
    lines.push(`_未检出 imports 循环依赖_`);
  } else {
    cycles.forEach((cycle, i) => {
      const display = cycle.slice(0, MAX_CYCLE_NODES);
      const ellipsis = cycle.length > MAX_CYCLE_NODES ? " …" : "";
      lines.push(`${i + 1}. ${display.map((n) => `\`${escapeCell(n)}\``).join(" → ")}${ellipsis}`);
    });
  }
  lines.push("");
  return lines.join("\n");
}

function escapeCell(value: string) {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}
