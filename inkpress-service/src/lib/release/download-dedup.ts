/**
 * 下载计数幂等：同 IP + 同 releaseId 在窗口内只计一次 downloadCount。
 *
 * 防止攻击者脚本循环请求把计数刷高、或正常用户重复点击把计数虚高。
 * 不阻塞下载（仍返回签名 URL），只是不重复 +1。
 *
 * 实现：进程内 Map<key, timestamp>，滑动窗口。
 * 与 src/lib/rate-limit/index.ts、src/lib/risk/anomaly.ts 同架构：
 *   - 仅 Node.js runtime 启用
 *   - 定时清理过期 key
 *   - timer.unref 避免阻塞进程退出
 *
 * 多实例部署注意：进程内 Map 不跨实例共享。
 * 当前单实例 Docker 部署够用；迁移多实例时改 Redis SETEX + NX。
 */
const WINDOW_SEC = 30 * 60; // 30 分钟内同 IP+同版本不重复计数
const MAX_ENTRIES = 10_000; // 上限保护，超出触发全量清理
const CLEANUP_INTERVAL_SEC = 5 * 60; // 5 分钟周期清理过期 key

const store = new Map<string, number>(); // key: `${ip}:${releaseId}` → 上次计数时间戳(ms)

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureTimer(): void {
  if (cleanupTimer || typeof setInterval === "undefined") return;
  cleanupTimer = setInterval(() => {
    const cutoff = Date.now() - WINDOW_SEC * 1000;
    let removed = 0;
    for (const [k, t] of store) {
      if (t < cutoff) {
        store.delete(k);
        removed++;
      }
    }
    if (removed > 0 && process.env.NODE_ENV !== "production") {
      // 仅开发态打日志，避免生产噪音
      // eslint-disable-next-line no-console
      console.log(`[download-dedup] 清理 ${removed} 条过期记录，剩余 ${store.size}`);
    }
  }, CLEANUP_INTERVAL_SEC * 1000);
  cleanupTimer.unref?.();
}

/**
 * 判断本次下载是否应计入 downloadCount。
 *
 * @returns true=应计数（首次或窗口外）；false=窗口内已计过，跳过 increment
 */
export function shouldCountDownload(ip: string, releaseId: string): boolean {
  // 非 Node.js runtime（如 Edge）— 安全起见不计数
  if (typeof setInterval === "undefined") return false;

  ensureTimer();

  const key = `${ip}:${releaseId}`;
  const now = Date.now();
  const last = store.get(key);

  if (last && now - last < WINDOW_SEC * 1000) {
    // 窗口内：刷新时间戳（滑动窗口），但不重复计数
    store.set(key, now);
    return false;
  }

  // 首次或窗口外：标记已计数
  store.set(key, now);

  // 上限保护：惰性全量清理
  if (store.size > MAX_ENTRIES) {
    const cutoff = now - WINDOW_SEC * 1000;
    for (const [k, t] of store) {
      if (t < cutoff) store.delete(k);
    }
  }

  return true;
}

/** 测试/运维用：手动清空（不影响生产） */
export function resetDownloadDedup(): void {
  store.clear();
}
