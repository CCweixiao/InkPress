import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { prisma } from "@/lib/db";
import { storageDir } from "@/lib/paths";
import { moduleLogger } from "@/lib/logger";
import type { AgentProjectConfig } from "@/lib/ai/agent-config";
import type { CodeRelation, ProjectIndex, SymbolEvidence } from "@/lib/ai/code-evidence";
import { listProjectFiles, resolveProjectRoot } from "@/lib/ai/project-access";

const log = moduleLogger("graphify-cache");
const execFileAsync = promisify(execFile);
export const GRAPHIFY_TIMEOUT_MS = 10 * 60 * 1000;
export const FAILED_RETRY_MS = 60 * 60 * 1000;
const GRAPHIFY_CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".py",
  ".java",
  ".go",
  ".rs",
  ".c",
  ".h",
  ".cc",
  ".cpp",
  ".cxx",
  ".hh",
  ".hpp",
  ".hxx",
  ".cs",
  ".kt",
  ".kts",
  ".swift",
  ".php",
  ".rb",
  ".scala",
  ".lua",
  ".sh",
  ".bash",
  ".zsh",
  ".sql",
  ".vue",
  ".svelte",
  ".astro",
  ".dart",
]);
const GRAPHIFY_MANIFEST_FILES = new Set([
  "package.json",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "jsconfig.json",
  "go.mod",
  "go.sum",
  "Cargo.toml",
  "Cargo.lock",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "requirements.txt",
  "pyproject.toml",
]);

type GraphifyNode = Record<string, unknown>;
type GraphifyEdge = Record<string, unknown>;

function safeSegment(value: string) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "unknown";
}

export function sourceKey(project: AgentProjectConfig) {
  return project.id || crypto.createHash("sha256").update(project.root).digest("hex").slice(0, 16);
}

export function codeGraphCacheBase(project: AgentProjectConfig, snapshotHash: string) {
  return path.join(
    storageDir(),
    "code-sources",
    safeSegment(sourceKey(project)),
    "snapshots",
    safeSegment(snapshotHash.slice(0, 64))
  );
}

export function graphifyOutDir(project: AgentProjectConfig, snapshotHash: string) {
  return path.join(codeGraphCacheBase(project, snapshotHash), "graphify-out");
}

export function relativeToStorage(absolutePath: string) {
  const root = path.resolve(storageDir());
  const absolute = path.resolve(absolutePath);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    throw new Error("代码图谱缓存路径越界。");
  }
  return path.relative(root, absolute).replaceAll(path.sep, "/");
}

export async function pathExists(target: string) {
  return fs
    .stat(target)
    .then((stat) => stat.isFile() || stat.isDirectory())
    .catch(() => false);
}

export async function graphifyAvailable() {
  try {
    await execFileAsync("graphify", ["--help"], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

async function gitHead(root: string) {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      timeout: 3_000,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function upsertCache(input: {
  project: AgentProjectConfig;
  root: string;
  snapshotHash: string;
  status: "building" | "ready" | "failed" | "stale";
  provider?: string;
  graphPath?: string | null;
  reportPath?: string | null;
  htmlPath?: string | null;
  nodeCount?: number;
  edgeCount?: number;
  lastError?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const provider = input.provider ?? "graphify";
  const existing = await prisma.codeGraphCache.findFirst({
    where: {
      provider,
      sourceKey: sourceKey(input.project),
      snapshotHash: input.snapshotHash,
      spaceId: null,
      articleId: null,
    },
  });
  const data = {
    provider,
    projectName: input.project.name,
    root: input.root,
    gitHead: await gitHead(input.root),
    status: input.status,
    graphPath: input.graphPath ?? undefined,
    reportPath: input.reportPath ?? undefined,
    htmlPath: input.htmlPath ?? undefined,
    nodeCount: input.nodeCount ?? undefined,
    edgeCount: input.edgeCount ?? undefined,
    lastError: input.lastError ?? null,
    metadataJson: JSON.stringify(input.metadata ?? {}),
  };
  if (existing) {
    return prisma.codeGraphCache.update({ where: { id: existing.id }, data });
  }
  return prisma.codeGraphCache.create({
    data: {
      sourceKey: sourceKey(input.project),
      snapshotHash: input.snapshotHash,
      spaceId: null,
      articleId: null,
      ...data,
    },
  });
}

function str(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseLocation(root: string, value: unknown) {
  const raw = str(value);
  if (!raw) return null;
  const match = raw.match(/^(.+?)(?::(\d+))?(?:[-:](\d+))?$/);
  const filePart = match?.[1] ?? raw;
  const startLine = Number(match?.[2] ?? 1);
  const endLine = Number(match?.[3] ?? startLine);
  const normalized = normalizeGraphPath(root, filePart);
  if (!normalized) return null;
  return {
    path: normalized,
    startLine: Math.max(1, startLine),
    endLine: Math.max(1, endLine || startLine),
  };
}

function normalizeGraphPath(root: string, value: unknown) {
  const raw = str(value).replaceAll("\\", "/");
  if (!raw || raw.includes("\n")) return null;
  const withoutLine = raw.replace(/:\d+(?::\d+)?$/, "");
  const absolute = path.isAbsolute(withoutLine)
    ? path.normalize(withoutLine)
    : path.normalize(path.join(root, withoutLine));
  const relative = path.relative(root, absolute).replaceAll(path.sep, "/");
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative;
  }
  const marker = `${path.sep}code-input${path.sep}`;
  const markerIndex = absolute.indexOf(marker);
  if (markerIndex >= 0) {
    return absolute.slice(markerIndex + marker.length).replaceAll(path.sep, "/");
  }
  return null;
}

function nodeLocation(root: string, node: GraphifyNode) {
  return (
    parseLocation(root, node.source_location) ??
    parseLocation(root, node.location) ??
    parseLocation(root, node.loc) ??
    (() => {
      const file = normalizeGraphPath(
        root,
        node.source_file ?? node.file ?? node.path ?? node.file_path
      );
      return file ? { path: file, startLine: 1, endLine: 1 } : null;
    })()
  );
}

function graphNodeId(node: GraphifyNode) {
  return str(node.id) || str(node.key) || str(node.name) || str(node.label);
}

function graphNodeName(node: GraphifyNode) {
  return str(node.label) || str(node.name) || graphNodeId(node);
}

function relationKind(value: unknown): CodeRelation["kind"] {
  const raw = str(value).toLowerCase();
  if (raw.includes("call") || raw.includes("invoke")) return "calls";
  if (raw.includes("import") || raw.includes("depend") || raw.includes("use")) return "imports";
  if (raw.includes("extend") || raw.includes("inherit")) return "extends";
  if (raw.includes("implement")) return "implements";
  return "references";
}

function isGraphifyCodeInput(relativePath: string) {
  const basename = path.posix.basename(relativePath);
  if (GRAPHIFY_MANIFEST_FILES.has(basename)) return true;
  return GRAPHIFY_CODE_EXTENSIONS.has(path.posix.extname(relativePath).toLowerCase());
}

async function linkOrCopyFile(source: string, target: string) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.link(source, target).catch(async () => {
    await fs.copyFile(source, target);
  });
}

export async function prepareGraphifyCodeMirror(project: AgentProjectConfig, root: string, base: string) {
  const mirror = path.join(base, "code-input");
  await fs.rm(mirror, { recursive: true, force: true });
  const listed = await listProjectFiles(project, { limit: 5_000 });
  const files = listed.files.filter(isGraphifyCodeInput);
  if (files.length === 0) return { scanRoot: root, fileCount: 0, mirrored: false };
  for (const relative of files) {
    const source = path.join(root, relative);
    const target = path.join(mirror, relative);
    await linkOrCopyFile(source, target);
  }
  return { scanRoot: mirror, fileCount: files.length, mirrored: true };
}

function graphifyToProjectIndex(input: {
  project: AgentProjectConfig;
  root: string;
  snapshotHash: string;
  generatedAt: string;
  graph: Record<string, unknown>;
}): ProjectIndex | null {
  const rawNodes = Array.isArray(input.graph.nodes) ? input.graph.nodes : [];
  const rawEdges = Array.isArray(input.graph.edges)
    ? input.graph.edges
    : Array.isArray(input.graph.links)
      ? input.graph.links
      : [];
  const symbols: SymbolEvidence[] = [];
  const nodesById = new Map<string, GraphifyNode>();
  for (const item of rawNodes) {
    if (!item || typeof item !== "object") continue;
    const node = item as GraphifyNode;
    const id = graphNodeId(node);
    if (id) nodesById.set(id, node);
    const location = nodeLocation(input.root, node);
    const name = graphNodeName(node);
    if (!location || !name) continue;
    symbols.push({
      id: id || `${location.path}#${name}:${location.startLine}`,
      name: name.slice(0, 200),
      kind: str(node.kind) || str(node.type) || str(node.category) || "GraphNode",
      language: str(node.language) || "graphify",
      path: location.path,
      startLine: location.startLine,
      endLine: Math.max(location.startLine, location.endLine),
      ...(str(node.parent) ? { container: str(node.parent) } : {}),
    });
  }

  const edges: CodeRelation[] = [];
  for (const item of rawEdges) {
    if (!item || typeof item !== "object") continue;
    const edge = item as GraphifyEdge;
    const from = str(edge.from) || str(edge.source) || str(edge.src);
    const to = str(edge.to) || str(edge.target) || str(edge.dst);
    if (!from || !to) continue;
    const location =
      parseLocation(input.root, edge.source_location) ??
      parseLocation(input.root, edge.location) ??
      nodeLocation(input.root, nodesById.get(from) ?? {}) ??
      nodeLocation(input.root, nodesById.get(to) ?? {});
    if (!location) continue;
    edges.push({
      from,
      to,
      kind: relationKind(edge.kind ?? edge.type ?? edge.label ?? edge.relation),
      confidence: str(edge.confidence) === "resolved" ? "resolved" : "inferred",
      evidence: {
        path: location.path,
        startLine: location.startLine,
        endLine: Math.max(location.startLine, location.endLine),
        summary: str(edge.label) || str(edge.type) || `${from} -> ${to}`,
      },
    });
  }

  if (symbols.length === 0 && edges.length === 0) return null;
  const files = new Map<string, { path: string; language: string; hash: string; size: number }>();
  for (const symbol of symbols) {
    if (!files.has(symbol.path)) {
      files.set(symbol.path, {
        path: symbol.path,
        language: symbol.language,
        hash: "",
        size: 0,
      });
    }
  }
  return {
    version: 1,
    projectId: input.project.id,
    root: input.root,
    snapshotHash: input.snapshotHash,
    generatedAt: input.generatedAt,
    accessedAt: new Date().toISOString(),
    files: [...files.values()],
    symbols,
    edges,
    parseErrors: [],
    truncated: false,
  };
}

export async function readGraphifyProjectIndex(
  project: AgentProjectConfig,
  snapshotHash: string
) {
  const root = await resolveProjectRoot(project);
  const graphPath = path.join(graphifyOutDir(project, snapshotHash), "graph.json");
  const raw = await fs.readFile(graphPath, "utf8").catch(() => "");
  if (!raw) return null;
  try {
    const graph = JSON.parse(raw) as Record<string, unknown>;
    return graphifyToProjectIndex({
      project,
      root,
      snapshotHash,
      generatedAt: new Date().toISOString(),
      graph,
    });
  } catch (error) {
    log.warn(
      { projectId: project.id, message: error instanceof Error ? error.message : String(error) },
      "Graphify graph.json 解析失败"
    );
    return null;
  }
}

export async function ensureGraphifyProjectIndex(
  project: AgentProjectConfig,
  snapshotHash: string,
  options: { refresh?: boolean } = {}
) {
  // 薄壳转发到统一编排器；强制使用 graphify CLI provider 以保持向后兼容。
  const { ensureCodeGraphCache } = await import("@/lib/ai/code-graph-provider");
  return ensureCodeGraphCache({
    project,
    snapshotHash,
    options: { refresh: options.refresh, provider: "graphify" },
  });
}

export async function queryGraphifyProject(input: {
  project: AgentProjectConfig;
  snapshotHash: string;
  question: string;
  budget?: number;
}) {
  const { graphifyCliProvider } = await import("@/lib/ai/code-graph-provider");
  // 先确保图谱已构建（命中缓存即读盘，未命中且 CLI 不可用时返回 ok:false）。
  await ensureGraphifyProjectIndex(input.project, input.snapshotHash);
  if (!graphifyCliProvider.query) {
    return {
      ok: false,
      usedGraph: false,
      snapshotHash: input.snapshotHash,
      output: "graphify provider 未实现 query。",
    };
  }
  return graphifyCliProvider.query({
    project: input.project,
    snapshotHash: input.snapshotHash,
    question: input.question,
    budget: input.budget,
  });
}
