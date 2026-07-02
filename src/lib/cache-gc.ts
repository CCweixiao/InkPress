import fs from "node:fs";
import path from "node:path";
import { cacheDir, claudeAgentRuntimeDir } from "@/lib/paths";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("cache.gc");

/** 文件最大年龄（超过则视为滞留缓存清理）。7 天。 */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** 定时 GC 间隔。每日。 */
const RUN_INTERVAL_MS = 24 * 60 * 60 * 1000;
/**
 * 顶层由其它模块自管、通用 GC 跳过的子目录：
 * - claude-agent：由 runClaudeTranscriptGc() 精确清理其 config/projects 下 transcript（见下），通用扫描不介入；
 * - code-index：project-index.ts 已有 cleanupOldIndexes。
 */
const SKIP_SUBDIRS = new Set(["claude-agent", "code-index"]);
/**
 * Claude Agent SDK transcript（config/projects 下各 sessionId.jsonl）保留天数。
 * B6 发现：SDK 即便挂了自定义 Prisma SessionStore，仍把完整 transcript JSONL 落到 config/projects，
 * 与 DB ClaudeAgentSessionEntry 重复（实测 2 天 5.4MB）。DB 是 resume 事实源（sessionStore.load），
 * 故磁盘 transcript 仅作 SDK 内部物化；按 Claude Code 默认 30 天保留做兜底清理，env 可调。
 */
const TRANSCRIPT_RETENTION_DAYS = Math.max(
  1,
  Number(process.env.INKPRESS_CLAUDE_TRANSCRIPT_RETENTION_DAYS ?? 30)
);
const TRANSCRIPT_MAX_AGE_MS = TRANSCRIPT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export interface CacheGcResult {
  deletedFiles: number;
  reclaimedBytes: number;
}

/**
 * 扫描 cacheDir()，按 mtime 清理超过 MAX_AGE_MS 的滞留文件（上传分片碎片、杂项临时文件等）。
 * 跳过自管子目录；递归清理随之产生的空目录。失败不抛（GC 不应阻断业务）。
 */
export function runCacheGc(): CacheGcResult {
  const root = cacheDir();
  const cutoff = Date.now() - MAX_AGE_MS;
  const result: CacheGcResult = { deletedFiles: 0, reclaimedBytes: 0 };
  try {
    walk(root, root, cutoff, result);
  } catch (e) {
    log.warn({ err: e }, "缓存 GC 失败");
  }
  return result;
}

function walk(
  dir: string,
  root: string,
  cutoff: number,
  result: CacheGcResult
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    // 顶层跳过自管子目录
    if (dir === root && ent.isDirectory() && SKIP_SUBDIRS.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walk(full, root, cutoff, result);
      // 清理因此变空的目录（非根）
      if (full !== root) {
        try {
          if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
        } catch {
          /* 忽略 */
        }
      }
    } else if (ent.isFile()) {
      try {
        const st = fs.statSync(full);
        if (st.mtimeMs < cutoff) {
          fs.unlinkSync(full);
          result.deletedFiles += 1;
          result.reclaimedBytes += st.size;
        }
      } catch {
        /* 忽略单个文件失败 */
      }
    }
  }
}

/**
 * B6：清理 Claude Agent SDK 落盘的陈旧 transcript（config/projects/**\/*.jsonl）。
 *
 * 仅按 mtime 清理超过 TRANSCRIPT_RETENTION_DAYS 的 .jsonl，并清空随之产生的空目录；
 * 不触碰 .claude.json / sessions/ / backups/ 等 SDK 运行态。DB ClaudeAgentSessionEntry 是
 * resume 事实源（sessionStore.load），磁盘 transcript 删除不影响跨轮/跨刷新记忆。
 */
export function runClaudeTranscriptGc(): CacheGcResult {
  const projectsDir = path.join(claudeAgentRuntimeDir(), "config", "projects");
  const result: CacheGcResult = { deletedFiles: 0, reclaimedBytes: 0 };
  if (!fs.existsSync(projectsDir)) return result;
  const cutoff = Date.now() - TRANSCRIPT_MAX_AGE_MS;
  try {
    for (const ent of fs.readdirSync(projectsDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      sweepTranscriptDir(path.join(projectsDir, ent.name), cutoff, result);
    }
  } catch (e) {
    log.warn({ err: e }, "Claude transcript GC 失败");
  }
  return result;
}

function sweepTranscriptDir(
  dir: string,
  cutoff: number,
  result: CacheGcResult
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      sweepTranscriptDir(full, cutoff, result); // 递归 subagents/
      try {
        if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
      } catch {
        /* 忽略 */
      }
    } else if (ent.isFile() && ent.name.endsWith(".jsonl")) {
      try {
        const st = fs.statSync(full);
        if (st.mtimeMs < cutoff) {
          fs.unlinkSync(full);
          result.deletedFiles += 1;
          result.reclaimedBytes += st.size;
        }
      } catch {
        /* 忽略 */
      }
    }
  }
}

/**
 * 启动缓存 GC 调度：启动时立即跑一次（通用 + Claude transcript）+ 每日定时（unref，不阻塞退出）。
 * 仅在 nodejs runtime 执行（避免 Edge）。
 */
export function startCacheGcScheduler(): void {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  runBoth("启动");
  const timer = setInterval(() => runBoth("定时"), RUN_INTERVAL_MS);
  timer.unref();
}

function runBoth(phase: string): void {
  const generic = runCacheGc();
  const transcript = runClaudeTranscriptGc();
  const total = {
    deletedFiles: generic.deletedFiles + transcript.deletedFiles,
    reclaimedBytes: generic.reclaimedBytes + transcript.reclaimedBytes,
  };
  if (total.deletedFiles > 0) {
    log.info({ ...total, generic, transcript, phase }, "缓存 GC 完成");
  }
}
