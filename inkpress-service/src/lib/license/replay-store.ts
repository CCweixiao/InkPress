/**
 * nonce 防重放存储（PDC §5.3：nonce 10 分钟内不可重复）。
 *
 * 进程内 Map<nonce, expiraTs> + 周期清理，与 rate-limit 同为单实例内存方案；
 * 多实例部署需迁移 Redis。仅在签名校验通过后调用，避免未鉴权请求污染存储。
 */

const DEFAULT_TTL_SEC = 10 * 60; // 10 分钟

const store = new Map<string, number>();

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const SWEEP_MAX_AGE_MS = 60 * 60 * 1000;

if (process.env.NEXT_RUNTIME === "nodejs") {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, exp] of store) {
      if (exp <= now) store.delete(k);
    }
  }, SWEEP_INTERVAL_MS);
  timer.unref?.();
}

export interface ReplayDecision {
  replayed: boolean;
}

/** 未见过则登记并在 ttl 后过期；已登记且未过期 → replayed=true。 */
export function checkAndStoreNonce(
  nonce: string,
  ttlSec = DEFAULT_TTL_SEC
): ReplayDecision {
  const now = Date.now();
  const exp = store.get(nonce);
  if (exp !== undefined && exp > now) {
    return { replayed: true };
  }
  store.set(nonce, now + ttlSec * 1000);
  return { replayed: false };
}

// 仅供测试：清空存储
export function _resetReplayStoreForTest(): void {
  store.clear();
}
