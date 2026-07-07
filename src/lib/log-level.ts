import { prisma } from "@/lib/db";
import { moduleLogger, setLogLevel } from "@/lib/logger";

const log = moduleLogger("log-level");

/** SystemConfig key：持久化的日志级别偏好 */
export const LOG_LEVEL_KEY = "inkpress.log-level";

/** 合法 pino 级别（含 silent） */
const VALID_LEVELS = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
  "silent",
];

function normalize(level: string): string {
  return level.trim().toLowerCase();
}

/** 读取持久化的日志级别（未设置返回 null）。 */
export async function getPersistedLogLevel(): Promise<string | null> {
  const row = await prisma.systemConfig.findUnique({
    where: { key: LOG_LEVEL_KEY },
  });
  const v = row?.value?.trim();
  return v && VALID_LEVELS.includes(v.toLowerCase()) ? v.toLowerCase() : null;
}

/**
 * 持久化日志级别并即时应用到根 logger。
 * 非法级别抛错（API 层据此返回 400）。
 */
export async function persistLogLevel(level: string): Promise<string> {
  const l = normalize(level);
  if (!VALID_LEVELS.includes(l)) {
    throw new Error(`非法日志级别：${level}（合法：${VALID_LEVELS.join(", ")}）`);
  }
  await prisma.systemConfig.upsert({
    where: { key: LOG_LEVEL_KEY },
    update: { value: l },
    create: { key: LOG_LEVEL_KEY, value: l },
  });
  setLogLevel(l);
  log.info({ level: l }, "日志级别已更新");
  return l;
}

/** 启动时应用持久化的日志级别（未设置则保持构建/env 默认）。 */
export async function applyPersistedLogLevel(): Promise<void> {
  const l = await getPersistedLogLevel();
  if (l) setLogLevel(l);
}
