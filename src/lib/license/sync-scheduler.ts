/**
 * License 后台同步调度器。
 *
 * - 启动时立即跑一次 syncLicenseAndTrial（联网后立即登记/校验）。
 * - 之后每小时跑一次。
 *
 * 主要保证：
 * - 离线状态下本地状态文件被 monotonic 更新（trialLastCheckedAt）。
 * - 联网后立即锁定 trial / 刷新 license 凭证。
 */
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("license:sync-scheduler");

const SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1 小时

let timer: ReturnType<typeof setInterval> | null = null;

async function syncLicenseAndTrial() {
  try {
    const { readLocalLicenseState } = await import("@/lib/license/store");
    if (readLocalLicenseState()) {
      // 有 license 状态 → validate（刷新凭证 + 滚动宽限）
      const { validateLocalLicense } = await import("@/lib/license/client");
      await validateLocalLicense();
      log.debug("license validate 同步完成");
    } else {
      // 无 license → trial 探测/登记
      const { getOrCreateTrialState, evaluateTrial, probeTrialStatus } = await import(
        "@/lib/license/trial"
      );
      const state = getOrCreateTrialState();
      // 先本地评估（更新 trialLastCheckedAt）
      evaluateTrial(state);
      // 联网探测（失败不阻塞）
      try {
        await probeTrialStatus();
        log.debug("trial probe 同步完成");
      } catch (e) {
        // 离线时 probe 会失败，这是正常情况
        log.debug({ err: e }, "trial probe 失败（可能离线）");
      }
    }
  } catch (e) {
    log.warn({ err: e }, "license/trial 同步失败");
  }
}

export function startLicenseSyncScheduler() {
  if (timer) return; // 幂等：不重复启动
  // 立即跑一次（延迟 5s 避免与启动争抢资源）
  setTimeout(() => void syncLicenseAndTrial(), 5_000);
  timer = setInterval(() => void syncLicenseAndTrial(), SYNC_INTERVAL_MS);
  log.info(`同步调度器启动（间隔 ${SYNC_INTERVAL_MS / 1000}s）`);
}

export function stopLicenseSyncScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
