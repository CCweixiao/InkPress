import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { PENDING_APPROVAL_TTL_MS, resolveApproval } from "@/lib/ai/pending-approvals";
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
    if (
      grant.status === "pending" &&
      Date.now() - grant.createdAt.getTime() > PENDING_APPROVAL_TTL_MS
    ) {
      await prisma.toolActionGrant.update({
        where: { id: grant.id },
        data: { status: "expired", approvalTokenHash: null },
      });
      return NextResponse.json(
        { error: "审批已过期，请重新发送。", status: "expired" },
        { status: 409 }
      );
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
    const nextStatus = decision === "allow" ? "approved" : "rejected";
    const claimed = await prisma.toolActionGrant.updateMany({
      where: {
        id: grant.id,
        status: "pending",
        approvalTokenHash: grant.approvalTokenHash,
      },
      data: {
        status: nextStatus,
        approvalTokenHash: null,
      },
    });
    if (claimed.count !== 1) {
      const latest = await prisma.toolActionGrant.findUnique({
        where: { id: grant.id },
        select: { status: true },
      });
      return NextResponse.json(
        {
          error: `审批已处理（${latest?.status ?? "unknown"}）。`,
          status: latest?.status ?? "unknown",
        },
        { status: 409 }
      );
    }
    let trustedDomain: string | null = null;
    if (decision === "allow") {
      try {
        trustedDomain = await trustGrantDomain(grant);
      } catch (error) {
        await prisma.toolActionGrant
          .updateMany({
            where: { id: grant.id, status: nextStatus },
            data: { status: "rejected" },
          })
          .catch(() => undefined);
        resolveApproval(grant.id, "deny");
        throw error;
      }
    }
    // DB 已完成 claim 后再唤醒 canUseTool，避免 agent 继续执行时审批事实源仍是 pending。
    const woken = resolveApproval(grant.id, decision);
    return NextResponse.json({
      ok: true,
      status: nextStatus,
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
