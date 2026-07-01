import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { resolveApproval } from "@/lib/ai/pending-approvals";
import { addAllowedDomain } from "@/lib/ai/web-allowlist";
import {
  assessWebUrlRisk,
  summarizeRiskForAllowlist,
  type WebUrlRiskAssessment,
} from "@/lib/ai/web-url-risk";

export const runtime = "nodejs";

const schema = z.object({
  approvalToken: z.string().min(16),
  action: z.enum(["approve", "reject"]).default("approve"),
});

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function parseGrantMetadata(decisionJson: string): {
  input?: Record<string, unknown>;
  riskAssessment?: WebUrlRiskAssessment;
} {
  try {
    const parsed = JSON.parse(decisionJson) as {
      input?: Record<string, unknown>;
      riskAssessment?: WebUrlRiskAssessment;
    };
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function trustGrantDomain(grant: {
  toolName: string;
  decisionJson: string;
}): Promise<string | null> {
  if (grant.toolName !== "web_fetch") return null;
  const metadata = parseGrantMetadata(grant.decisionJson);
  const rawUrl = metadata.riskAssessment?.url ?? String(metadata.input?.url ?? "");
  if (!rawUrl) return null;
  const risk = metadata.riskAssessment ?? assessWebUrlRisk(rawUrl);
  if (!risk.domain) return null;
  await addAllowedDomain(
    risk.domain,
    `审批时加入：${summarizeRiskForAllowlist(risk)}`,
    risk
  );
  return risk.domain;
}

/**
 * P3 权限闸门决议端点（mirror /api/ai/code-sources/[id]/approve）。
 * 校验 pending grant + token → 唤醒 canUseTool 的 blocking-Promise（同一 in-flight query 继续）
 * + 写 grant.status（单一事实源）。woken=false 表示内存桥已丢失（进程重启等），流已死、需重发。
 */
export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "审批参数无效。" }, { status: 400 });
  }
  const decision = parsed.data.action === "approve" ? "allow" : "deny";
  try {
    const grant = await prisma.toolActionGrant.findUnique({ where: { id } });
    if (!grant) {
      return NextResponse.json({ error: "审批记录不存在。" }, { status: 404 });
    }
    if (grant.status !== "pending") {
      return NextResponse.json(
        { error: `审批已处理（${grant.status}）。`, status: grant.status },
        { status: 409 }
      );
    }
    if (
      !grant.approvalTokenHash ||
      hashToken(parsed.data.approvalToken) !== grant.approvalTokenHash
    ) {
      return NextResponse.json({ error: "令牌无效。" }, { status: 409 });
    }
    let trustedDomain: string | null = null;
    if (decision === "allow") {
      trustedDomain = await trustGrantDomain(grant);
    }
    // 唤醒 canUseTool 的 blocking-Promise；同一 in-flight query 自动恢复，无需用户重发。
    const woken = resolveApproval(grant.id, decision);
    const updated = await prisma.toolActionGrant.update({
      where: { id: grant.id },
      data: {
        status: decision === "allow" ? "approved" : "rejected",
        approvalTokenHash: null,
      },
    });
    return NextResponse.json({
      ok: true,
      status: updated.status,
      woken,
      trustedDomain,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "审批失败。" },
      { status: 500 }
    );
  }
}
