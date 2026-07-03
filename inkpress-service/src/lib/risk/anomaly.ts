import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("risk");

/**
 * 异常风控（PDC §9.3/§9.4 后台风控，Phase 4）。
 *
 * 与限流的本质区别：限流按「请求计数」限速；风控按「**失败结果模式**」识别
 * 攻击（key 枚举、签名爆破）并临时封禁来源 IP。两者叠加：先风控封禁判定，
 * 再常规限流计数。
 *
 * 单实例内存存储（与 rate-limit / replay-store 一致），仅 nodejs runtime 启用。
 * 多实例迁移 Redis 时替换本模块实现即可。
 */

export type RiskSignal = "ACTIVATION_FAILED" | "SIGNATURE_FAILED";

interface Rule {
  threshold: number;
  windowMs: number;
}

function intEnv(name: string, def: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : def;
}

const DISABLED = process.env.RISK_DISABLE === "true";

const RULES: Record<RiskSignal, Rule> = {
  ACTIVATION_FAILED: {
    threshold: intEnv("RISK_ACTIVATION_FAIL_THRESHOLD", 20),
    windowMs: intEnv("RISK_ACTIVATION_FAIL_WINDOW", 600) * 1000,
  },
  SIGNATURE_FAILED: {
    threshold: intEnv("RISK_SIGNATURE_FAIL_THRESHOLD", 30),
    windowMs: intEnv("RISK_SIGNATURE_FAIL_WINDOW", 600) * 1000,
  },
};

const BLOCK_MS = intEnv("RISK_BLOCK_MINUTES", 30) * 60 * 1000;

/** ip → signalType → 时间戳数组（滑动窗口） */
const signals = new Map<string, Map<RiskSignal, number[]>>();
/** ip → 封禁到期时间戳（ms） */
const blocked = new Map<string, number>();

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const SWEEP_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 信号窗口最长 2h 保留兜底

if (!DISABLED && process.env.NEXT_RUNTIME === "nodejs") {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [ip, map] of signals) {
      let empty = true;
      for (const [type, arr] of map) {
        const cutoff = now - RULES[type].windowMs;
        const fresh = arr.filter((t) => t > cutoff);
        if (fresh.length === 0) map.delete(type);
        else {
          map.set(type, fresh);
          empty = false;
        }
      }
      if (empty) signals.delete(ip);
    }
    for (const [ip, until] of blocked) {
      if (until <= now) blocked.delete(ip);
    }
  }, SWEEP_INTERVAL_MS);
  timer.unref?.();
  log.info(
    {
      rules: RULES,
      blockMin: BLOCK_MS / 60000,
    },
    "异常风控已启用"
  );
} else if (DISABLED) {
  log.warn("异常风控已通过 RISK_DISABLE=true 关闭");
}

/** 记录一次失败信号；超阈值则把该 IP 加入封禁。 */
export function recordSignal(ip: string, type: RiskSignal, now = Date.now()): void {
  if (DISABLED || !ip) return;
  const rule = RULES[type];
  const cutoff = now - rule.windowMs;

  const map = signals.get(ip) ?? new Map<RiskSignal, number[]>();
  const arr = (map.get(type) ?? []).filter((t) => t > cutoff);
  arr.push(now);
  map.set(type, arr);
  signals.set(ip, map);

  if (arr.length >= rule.threshold) {
    blocked.set(ip, now + BLOCK_MS);
    log.warn(
      { ip, type, count: arr.length, threshold: rule.threshold, blockMs: BLOCK_MS },
      "IP 因失败信号累计触发风控封禁"
    );
    // 触发后清空该类信号窗口，避免封禁期内持续累加计数
    map.delete(type);
  }
}

/** 查询 IP 是否处于风控封禁。 */
export function isIpBlocked(
  ip: string,
  now = Date.now()
): { blocked: boolean; retryAfterSec: number } {
  if (DISABLED || !ip) return { blocked: false, retryAfterSec: 0 };
  const until = blocked.get(ip);
  if (!until || until <= now) {
    if (until) blocked.delete(ip);
    return { blocked: false, retryAfterSec: 0 };
  }
  return { blocked: true, retryAfterSec: Math.ceil((until - now) / 1000) };
}
