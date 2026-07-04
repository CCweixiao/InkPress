import { NextResponse } from "next/server";
import { validateLocalLicense } from "@/lib/license/client";
import { isLicenseRequired, readLocalLicenseState } from "@/lib/license/store";
import { evaluateTrial, getOrCreateTrialState } from "@/lib/license/trial";
import type { LicenseRuntimeStatus } from "@/lib/license/client";

/**
 * 统一判定入口（单一信任边界）。
 *
 * 优先级：
 * 1. !isLicenseRequired → not-required
 * 2. 有本地 license state → validateLocalLicense（含 30 天 offline grace）
 * 3. 无 license → 试用判定（inTrial / expired）
 */
export async function licenseGuard(): Promise<LicenseRuntimeStatus> {
  if (!isLicenseRequired()) {
    return {
      required: false,
      allowed: true,
      mode: "not-required",
      state: null,
    };
  }
  // 有 license 状态文件 → 走正式校验
  if (readLocalLicenseState()) {
    return validateLocalLicense();
  }
  // 无 license → 试用判定
  const trialState = getOrCreateTrialState();
  const trialEval = evaluateTrial(trialState);
  if (trialEval.inTrial) {
    return {
      required: true,
      allowed: true,
      mode: "trial",
      state: null,
      trial: {
        trialExpiresAt: trialState.trialExpiresAt,
        remainingMs: trialEval.remainingMs,
      },
    };
  }
  return {
    required: true,
    allowed: false,
    mode: "trial-expired",
    state: null,
    trial: {
      trialExpiresAt: trialState.trialExpiresAt,
      remainingMs: 0,
    },
    message: trialEval.tampered
      ? "检测到时钟异常，试用已失效。"
      : "7 天免费试用已结束，请激活 License 继续使用。",
  };
}

export async function requireLicenseForApi() {
  const status = await licenseGuard();
  if (status.allowed) return null;
  return NextResponse.json(
    {
      error: status.message ?? "License 未激活或已失效。",
      code: "LICENSE_REQUIRED",
      license: status,
    },
    { status: 402 }
  );
}
