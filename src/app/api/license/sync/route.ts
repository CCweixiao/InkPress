import { NextResponse } from "next/server";
import { licenseGuard } from "@/lib/license/guard";
import { isLicenseRequired, readLocalLicenseState } from "@/lib/license/store";
import { signGate, GATE_COOKIE_NAME } from "@/lib/license/gate-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/license/sync — 手动触发同步（弹窗"重试"按钮调用）。
 *
 * 触发 license validate 或 trial probe（后台真正发起网络请求），
 * 然后回读本地状态并返回。
 */
export async function POST() {
  if (!isLicenseRequired()) {
    return NextResponse.json({
      required: false,
      allowed: true,
      mode: "not-required",
      state: null,
    });
  }

  // 有 license 状态 → 触发 validate（刷新凭证）
  // 无 license 状态 → guard 内部已自动创建/评估 trial，但不会主动联网
  // 这里通过动态导入触发后台同步
  try {
    if (readLocalLicenseState()) {
      const { validateLocalLicense } = await import("@/lib/license/client");
      await validateLocalLicense();
    } else {
      // trial 模式：尝试联网探测/登记
      const { probeTrialStatus } = await import("@/lib/license/trial");
      try {
        await probeTrialStatus();
      } catch {
        // 离线时 probe 失败不阻塞，guard 用本地状态判定
      }
    }
  } catch {
    // 网络错误不阻塞，guard 用本地状态判定
  }

  const status = await licenseGuard();

  const res = NextResponse.json(status);

  // 回写 gate cookie
  try {
    const gateValue = await signGate({
      allowed: status.allowed,
      mode: status.mode,
    });
    res.cookies.set(GATE_COOKIE_NAME, gateValue, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 300,
      path: "/",
    });
  } catch {
    // ignore
  }

  return res;
}
