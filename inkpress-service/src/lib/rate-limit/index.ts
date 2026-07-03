import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("rate-limit");

/**
 * 进程内滑动窗口限流（PDC §9.3）。
 *
 * 首期 SQLite 单实例 Docker 部署，内存限流足够；后续多实例迁移 Redis。
 * 以「key + 时间戳数组」实现精确滑动窗口，每次访问裁剪过期命中。
 */

export interface RateLimitRule {
  /** 窗口大小（秒） */
  windowSec: number;
  /** 窗口内最大请求数 */
  max: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** 命中限制时建议的重试等待秒数 */
  retryAfterSec: number;
  remaining: number;
}

const store = new Map<string, number[]>();

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const SWEEP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** 周期性清理完全过期 key，避免长期运行内存累积 */
if (process.env.NEXT_RUNTIME === "nodejs") {
  const timer = setInterval(() => {
    const cutoff = Date.now() - SWEEP_MAX_AGE_MS;
    for (const [k, arr] of store) {
      const fresh = arr.filter((t) => t > cutoff);
      if (fresh.length === 0) store.delete(k);
      else store.set(k, fresh);
    }
  }, SWEEP_INTERVAL_MS);
  timer.unref?.();
}

/**
 * 针对单个 (key, rule) 进行限流判定；命中则计数不增加。
 * 注意：传入默认 now 仅用于测试，生产请省略。
 */
export function rateLimit(
  key: string,
  rule: RateLimitRule,
  now = Date.now()
): RateLimitDecision {
  const windowMs = rule.windowSec * 1000;
  const cutoff = now - windowMs;
  const arr = (store.get(key) ?? []).filter((t) => t > cutoff);

  if (arr.length >= rule.max) {
    const oldest = arr[0];
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    store.set(key, arr);
    return { allowed: false, retryAfterSec, remaining: 0 };
  }

  arr.push(now);
  store.set(key, arr);
  return { allowed: true, retryAfterSec: 0, remaining: rule.max - arr.length };
}

/**
 * 依次检查多条规则；任一拒绝即返回该规则结果。
 * 顺序应为「最严格优先」（如每邮箱 60s 1 次 排前），减少误计数。
 * 拒绝时不消耗后续规则的配额。
 */
export function checkRateLimits(
  checks: Array<{ key: string; rule: RateLimitRule }>
): RateLimitDecision & { rule?: string } {
  for (const { key, rule } of checks) {
    const d = rateLimit(key, rule);
    if (!d.allowed) {
      log.warn({ key, rule, ...d }, "限流命中");
      return { ...d, rule: key };
    }
  }
  return { allowed: true, retryAfterSec: 0, remaining: 0 };
}
