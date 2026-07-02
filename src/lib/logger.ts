import fs from "node:fs";
import path from "node:path";
import pino from "pino";
import { logsDir } from "@/lib/paths";

/**
 * 统一日志模块（pino）。
 *
 * 双路输出：
 * - stdout（控制台 / 容器友好）
 * - 文件滚动：~/.inkpress/logs/inkpress.log，单文件 20MB，最多保留 5 个
 *
 * 日志格式：JSON 行（便于程序解析），开发模式额外用 pino-pretty 美化控制台输出。
 */

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_FILES = 5;

function ensureLogsDir(): string {
  const dir = logsDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const isDev = process.env.NODE_ENV !== "production";

// 文件目标：pino 内置 rotation（通过 transport 的 rotate 选项由 sonic-boom 处理）
// pino 的 file transport 不直接支持滚动，这里用 multistream + 自实现滚动日志文件。
// 为保持依赖最小，采用 pino 的 destination + 手动滚动检查。

const logFilePath = path.join(ensureLogsDir(), "inkpress.log");

/** 检查并执行日志文件滚动（超过 MAX_FILE_SIZE 则重命名历史，保留 MAX_FILES 个） */
function rotateIfNeeded() {
  try {
    const stat = fs.statSync(logFilePath);
    if (stat.size < MAX_FILE_SIZE) return;
    // 滚动：inkpress.log.4 → 删除，.3→.4，.2→.3，.1→.2，inkpress.log → .1
    for (let i = MAX_FILES - 1; i >= 1; i--) {
      const src = i === 1 ? logFilePath : `${logFilePath}.${i - 1}`;
      const dest = `${logFilePath}.${i}`;
      if (fs.existsSync(src)) {
        if (i === MAX_FILES && fs.existsSync(dest)) fs.unlinkSync(dest);
        fs.renameSync(src, dest);
      }
    }
  } catch {
    // 文件不存在等，忽略
  }
}

// 定时检查滚动（每 30s），避免高频 stat 开销
if (process.env.NEXT_RUNTIME === "nodejs") {
  setInterval(rotateIfNeeded, 30_000).unref();
}

// 多路输出：stdout + 文件
//
// 注意：pino.transport() 会通过 thread-stream 创建 Worker 线程，Worker 内动态 require
// pino-abstract-transport / split2 等依赖，Next.js standalone 的静态分析无法追踪，
// 导致打包后 Cannot find module。
// 生产环境用同步 multistream（不走 Worker），开发环境仍用 pino-pretty 的 transport。
// INKPRESS_HOME 由 Electron 主进程注入（仅打包形态设置），作为打包环境判据。
const isPackaged = !!process.env.INKPRESS_HOME;

let logger: pino.Logger;
if (isDev && !isPackaged) {
  // 开发：pino-pretty 美化输出（走 transport/Worker，但开发环境 node_modules 完整）
  const transport = pino.transport({
    targets: [
      {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l" } as unknown as { destination: number },
        level: "trace",
      },
      {
        target: "pino/file",
        options: { destination: logFilePath, mkdir: true } as unknown as { destination: number },
        level: "info",
      },
    ],
  });
  logger = pino(
    {
      level: process.env.LOG_LEVEL ?? "info",
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level(label) { return { level: label }; } },
    },
    transport
  );
} else {
  // 生产：同步 multistream（不走 Worker 线程，无需 pino-abstract-transport）
  const fileDest = pino.destination({ dest: logFilePath, mkdir: true });
  const stdoutDest = pino.destination(1);
  logger = pino(
    {
      level: process.env.LOG_LEVEL ?? "info",
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level(label) { return { level: label }; } },
    },
    pino.multistream([
      { level: "info", stream: fileDest },
      { level: "info", stream: stdoutDest },
    ])
  );
}
export { logger };

/** 创建带 module 标签的子日志（约定用法：logger.module("db")） */
export function moduleLogger(module: string) {
  return logger.child({ module });
}

/**
 * 运行时修改日志级别（B10）。
 * 仅改根 logger 的 level 过滤；多路输出的 stream 自身级别不变，故"完整生效"建议重启。
 * 非法级别静默忽略。
 */
export function setLogLevel(level: string): void {
  const l = level.trim().toLowerCase();
  if (!l) return;
  try {
    (logger as pino.Logger).level = l;
  } catch {
    /* 非法级别，忽略 */
  }
}

export { logFilePath, rotateIfNeeded };
