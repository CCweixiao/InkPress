import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { storageDir } from "@/lib/paths";
import { moduleLogger } from "@/lib/logger";
import type { AgentProjectConfig } from "@/lib/ai/agent-config";
import type { ProjectIndex } from "@/lib/ai/code-evidence";
import { resolveProjectRoot } from "@/lib/ai/project-access";
import {
  buildProjectIndex,
  hydrateProjectIndex,
  type ProjectIndexBuildMode,
} from "@/lib/ai/project-index";
import { generateGraphReport } from "@/lib/ai/code-graph-report";
import { generateGraphHtml } from "@/lib/ai/code-graph-html";
import {
  codeGraphCacheBase,
  graphifyOutDir,
  readGraphifyProjectIndex,
  relativeToStorage,
  upsertCache,
  sourceKey,
  pathExists,
  graphifyAvailable,
  prepareGraphifyCodeMirror,
  FAILED_RETRY_MS,
  GRAPHIFY_TIMEOUT_MS,
} from "@/lib/ai/graphify-cache";

const log = moduleLogger("code-graph");

export type GraphProviderId = "native" | "graphify";

export interface GraphBuildResult {
  graphPath: string;
  reportPath: string | null;
  htmlPath: string | null;
  nodeCount: number;
  edgeCount: number;
  metadata: Record<string, unknown>;
}

export interface GraphQueryResult {
  ok: boolean;
  usedGraph: boolean;
  snapshotHash: string;
  output: string;
  stats?: { symbols: number; edges: number };
}

export interface CodeGraphProvider {
  id: GraphProviderId;
  available(): Promise<boolean>;
  build(input: {
    project: AgentProjectConfig;
    root: string;
    snapshotHash: string;
    mode?: ProjectIndexBuildMode;
    artifacts?: boolean;
  }): Promise<GraphBuildResult & { index: ProjectIndex }>;
  query?(input: {
    project: AgentProjectConfig;
    snapshotHash: string;
    question: string;
    budget?: number;
  }): Promise<GraphQueryResult>;
}

/**
 * 原子写文件：先写临时文件再 rename，避免大项目构建被中断时留下半成品/截断的 graph.json
 * （POSIX 同文件系统 rename 是原子的）。临时文件与目标在同一目录，确保落在同一文件系统。
 */
async function writeAtomic(target: string, data: string) {
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await fs.writeFile(tmp, data, "utf8");
  try {
    await fs.rename(tmp, target);
  } catch (error) {
    await fs.rm(tmp, { force: true });
    throw error;
  }
}

/** 读取图谱落盘后的 ProjectIndex；不同 provider 的 graph.json 格式不同。 */
async function readProviderIndex(
  provider: GraphProviderId,
  project: AgentProjectConfig,
  snapshotHash: string
): Promise<ProjectIndex | null> {
  if (provider === "graphify") {
    const index = await readGraphifyProjectIndex(project, snapshotHash);
    return index ? hydrateProjectIndex(index) : null;
  }
  const graphPath = path.join(graphifyOutDir(project, snapshotHash), "graph.json");
  const raw = await fs.readFile(graphPath, "utf8").catch(() => "");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ProjectIndex;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.symbols)) {
      return null;
    }
    parsed.accessedAt = new Date().toISOString();
    return hydrateProjectIndex(parsed);
  } catch (error) {
    log.warn(
      { provider, message: error instanceof Error ? error.message : String(error) },
      "native graph.json 解析失败"
    );
    return null;
  }
}

/**
 * 原生图谱 provider：零外部依赖，纯 Node。
 * 产出三件套：graph.json（ProjectIndex）+ GRAPH_REPORT.md + graph.html（内联 mermaid）。
 */
export const nativeProvider: CodeGraphProvider = {
  id: "native",
  async available() {
    return true;
  },
  async build({ project, root, snapshotHash, mode = "fast", artifacts = true }) {
    const index = await buildProjectIndex(project, { mode, persist: false });
    const outDir = graphifyOutDir(project, snapshotHash);
    const graphPath = path.join(outDir, "graph.json");
    const reportPath = path.join(outDir, "GRAPH_REPORT.md");
    const htmlPath = path.join(outDir, "graph.html");
    await fs.mkdir(outDir, { recursive: true });
    if (artifacts) {
      // 写入顺序：先报告和 HTML，最后原子写 graph.json。
      // graph.json 的存在即代表整次三件套已完整落盘——超大项目构建耗时长、被中断概率高，
      // 这样可避免出现「有 graph.json 但缺报告/HTML」的半成品，也避免截断的 graph.json 被当作合法缓存。
      const report = generateGraphReport(index);
      await writeAtomic(reportPath, report);
      const html = await generateGraphHtml(index);
      await writeAtomic(htmlPath, html);
    }
    await writeAtomic(graphPath, JSON.stringify(index));
    return {
      graphPath,
      reportPath: artifacts ? reportPath : null,
      htmlPath: artifacts ? htmlPath : null,
      nodeCount: index.symbols.length,
      edgeCount: index.edges.length,
      metadata: {
        provider: "native",
        originalRoot: root,
        graphifyOut: outDir,
        files: index.files.length,
        mode,
        artifacts,
        languages: index.languageStats,
        parseErrors: index.parseErrors.length,
        truncated: index.truncated,
      },
      index,
    };
  },
};

/** Graphify CLI provider：调用外部 Python 工具 graphifyy。 */
export const graphifyCliProvider: CodeGraphProvider = {
  id: "graphify",
  async available() {
    return graphifyAvailable();
  },
  async build({ project, root, snapshotHash }) {
    const outDir = graphifyOutDir(project, snapshotHash);
    const graphPath = path.join(outDir, "graph.json");
    const reportPath = path.join(outDir, "GRAPH_REPORT.md");
    const htmlPath = path.join(outDir, "graph.html");
    const base = codeGraphCacheBase(project, snapshotHash);
    const scan = await prepareGraphifyCodeMirror(project, root, base);
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    const graphifyEnv = {
      ...process.env,
      GRAPHIFY_OUT: outDir,
      GRAPHIFY_NO_TIPS: "1",
    };
    const args = (await pathExists(graphPath))
      ? ["update", scan.scanRoot, "--no-cluster"]
      : ["extract", scan.scanRoot, "--out", base, "--no-cluster"];
    await execFileAsync("graphify", args, {
      cwd: base,
      env: graphifyEnv,
      timeout: GRAPHIFY_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    });
    const rawIndex = await readGraphifyProjectIndex(project, snapshotHash);
    if (!rawIndex) {
      throw new Error("Graphify 构建完成但 graph.json 为空或不可解析。");
    }
    const index = hydrateProjectIndex(rawIndex);
    return {
      graphPath,
      reportPath: (await pathExists(reportPath)) ? reportPath : null,
      htmlPath: (await pathExists(htmlPath)) ? htmlPath : null,
      nodeCount: index.symbols.length,
      edgeCount: index.edges.length,
      metadata: {
        provider: "graphify",
        command: ["graphify", ...args],
        graphifyOut: outDir,
        originalRoot: root,
        scanRoot: scan.scanRoot,
        mirroredFiles: scan.fileCount,
      },
      index,
    };
  },
  async query(input) {
    const index = await readProviderIndex("graphify", input.project, input.snapshotHash);
    const graphPath = path.join(
      graphifyOutDir(input.project, input.snapshotHash),
      "graph.json"
    );
    if (!index || !(await pathExists(graphPath))) {
      return {
        ok: false,
        usedGraph: false,
        snapshotHash: input.snapshotHash,
        output: "当前快照没有可用的 Graphify 代码图谱。",
      };
    }
    if (!(await graphifyAvailable())) {
      return {
        ok: false,
        usedGraph: false,
        snapshotHash: input.snapshotHash,
        output: "已存在 graph.json，但当前环境没有 graphify CLI，无法执行图谱 query。",
      };
    }
    try {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);
      const { stdout } = await execFileAsync(
        "graphify",
        [
          "query",
          input.question,
          "--graph",
          graphPath,
          "--budget",
          String(Math.min(20_000, Math.max(1_000, input.budget ?? 8_000))),
        ],
        {
          cwd: codeGraphCacheBase(input.project, input.snapshotHash),
          env: {
            ...process.env,
            GRAPHIFY_OUT: graphifyOutDir(input.project, input.snapshotHash),
            GRAPHIFY_NO_TIPS: "1",
          },
          timeout: 60_000,
          maxBuffer: 2 * 1024 * 1024,
        }
      );
      return {
        ok: true,
        usedGraph: true,
        snapshotHash: input.snapshotHash,
        output: stdout.trim().slice(0, 40_000),
        stats: { symbols: index.symbols.length, edges: index.edges.length },
      };
    } catch (error) {
      return {
        ok: false,
        usedGraph: false,
        snapshotHash: input.snapshotHash,
        output: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

/**
 * 选择 provider：
 * 1. preference === "graphify" 且 CLI 可用 → graphify
 * 2. preference === "native" → native（永远可用）
 * 3. 未指定 → native（默认零依赖）
 */
export function selectProvider(preference?: GraphProviderId): CodeGraphProvider {
  if (preference === "graphify") return graphifyCliProvider;
  return nativeProvider;
}

/** 同步版（不检查 CLI 可用性）：用于已经决定 provider 后直接取实例。 */
export function getProvider(id: GraphProviderId): CodeGraphProvider {
  return id === "graphify" ? graphifyCliProvider : nativeProvider;
}

const buildLocks = new Map<string, Promise<ProjectIndex | null>>();

/**
 * 构建编排器（替代 ensureGraphifyProjectIndex）。
 *
 * 流程：
 * 1. 查 ready 记录 → 路径存在则直接读 graph.json
 * 2. 查 1h 内的 failed 记录 → 返回 null（避免反复重试）
 * 3. graph.json 已落盘 → 读
 * 4. 否则 upsertCache(building) → provider.build() → 写三件套 → upsertCache(ready)
 * 5. 失败 → upsertCache(failed)
 */
export async function ensureCodeGraphCache(input: {
  project: AgentProjectConfig;
  snapshotHash: string;
  options?: {
    refresh?: boolean;
    provider?: GraphProviderId;
    mode?: ProjectIndexBuildMode;
    artifacts?: boolean;
  };
}): Promise<ProjectIndex | null> {
  const provider = selectProvider(input.options?.provider);
  const mode = input.options?.mode ?? "fast";
  const artifacts = input.options?.artifacts ?? false;
  const { project, snapshotHash } = input;
  const root = await resolveProjectRoot(project);
  const key = sourceKey(project);

  const ready = await prisma.codeGraphCache.findFirst({
    where: {
      provider: provider.id,
      sourceKey: key,
      snapshotHash,
      status: "ready",
      spaceId: null,
      articleId: null,
    },
    orderBy: { updatedAt: "desc" },
  });
  const readyGraphExists =
    ready?.graphPath && (await pathExists(path.join(storageDir(), ready.graphPath)));
  const readyArtifactsExist =
    !artifacts ||
    provider.id !== "native" ||
    Boolean(
      ready?.reportPath &&
        ready?.htmlPath &&
        (await pathExists(path.join(storageDir(), ready.reportPath))) &&
        (await pathExists(path.join(storageDir(), ready.htmlPath)))
    );
  if (!input.options?.refresh && readyGraphExists && readyArtifactsExist) {
    const cached = await readProviderIndex(provider.id, project, snapshotHash);
    if (cached && (provider.id !== "native" || (cached.buildMode ?? "fast") === mode)) {
      return cached;
    }
  }

  const failed = await prisma.codeGraphCache.findFirst({
    where: {
      provider: provider.id,
      sourceKey: key,
      snapshotHash,
      status: "failed",
      spaceId: null,
      articleId: null,
    },
    orderBy: { updatedAt: "desc" },
  });
  if (
    !input.options?.refresh &&
    failed &&
    Date.now() - failed.updatedAt.getTime() < FAILED_RETRY_MS
  ) {
    return null;
  }

  const graphPath = path.join(graphifyOutDir(project, snapshotHash), "graph.json");
  if (!input.options?.refresh && (await pathExists(graphPath))) {
    const cached = await readProviderIndex(provider.id, project, snapshotHash);
    if (cached && (provider.id !== "native" || (cached.buildMode ?? "fast") === mode)) {
      return cached;
    }
    // graph.json 存在但不可解析（截断/半成品/旧格式）→ 不直接返回 null，
    // 落入下方重建流程，避免脏 graph.json 永久卡死图谱功能。
    log.warn(
      { provider: provider.id, projectId: project.id },
      "graph.json 存在但不可解析，触发重建"
    );
  }

  const lockKey = `${provider.id}:${key}:${snapshotHash}:${mode}:${artifacts ? "artifacts" : "index"}`;
  const existingBuild = buildLocks.get(lockKey);
  if (existingBuild) return existingBuild;

  const buildPromise = (async () => {
    await fs.mkdir(codeGraphCacheBase(project, snapshotHash), { recursive: true });
    await upsertCache({
      project,
      root,
      snapshotHash,
      provider: provider.id,
      status: "building",
    });
    try {
      const built = await provider.build({ project, root, snapshotHash, mode, artifacts });
      await upsertCache({
        project,
        root,
        snapshotHash,
        status: "ready",
        provider: provider.id,
        graphPath: relativeToStorage(built.graphPath),
        reportPath: built.reportPath ? relativeToStorage(built.reportPath) : null,
        htmlPath: built.htmlPath ? relativeToStorage(built.htmlPath) : null,
        nodeCount: built.nodeCount,
        edgeCount: built.edgeCount,
        metadata: built.metadata,
      });
      return built.index;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await upsertCache({
        project,
        root,
        snapshotHash,
        status: "failed",
        provider: provider.id,
        lastError: message.slice(0, 1000),
        metadata: { provider: provider.id, artifacts },
      });
      log.warn(
        { provider: provider.id, projectId: project.id, message: message.split("\n")[0] },
        "代码图谱构建失败"
      );
      return null;
    } finally {
      buildLocks.delete(lockKey);
    }
  })();
  buildLocks.set(lockKey, buildPromise);
  return buildPromise;
}
