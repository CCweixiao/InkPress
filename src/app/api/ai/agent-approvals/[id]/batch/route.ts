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
  grantIds: z.array(z.string().min(1)).max(50).optional(),
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

async function trustGrantDomain(decisionJson: string): Promise<string | null> {
  const metadata = parseGrantMetadata(decisionJson);
  const rawUrl = metadata.riskAssessment?.url ?? String(metadata.input?.url ?? "");
  if (!rawUrl) return null;
  const risk = metadata.riskAssessment ?? assessWebUrlRisk(rawUrl);
  if (!risk.domain) return null;
  await addAllowedDomain(
    risk.domain,
    `批量审批加入：${summarizeRiskForAllowlist(risk)}`,
    risk
  );
  return risk.domain;
}

function grantToBatchItem(grant: {
  id: string;
  decisionJson: string;
  createdAt: Date;
}) {
  const metadata = parseGrantMetadata(grant.decisionJson);
  const rawUrl = metadata.riskAssessment?.url ?? String(metadata.input?.url ?? "");
  const riskAssessment =
    metadata.riskAssessment ?? (rawUrl ? assessWebUrlRisk(rawUrl) : null);
  return {
    grantId: grant.id,
    url: riskAssessment?.url ?? rawUrl,
    domain: riskAssessment?.domain ?? "",
    riskAssessment,
    createdAt: grant.createdAt.toISOString(),
  };
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const current = await prisma.toolActionGrant.findUnique({ where: { id } });
  if (!current) {
    return NextResponse.json({ error: "审批记录不存在。" }, { status: 404 });
  }
  if (current.toolName !== "web_fetch") {
    return NextResponse.json({ items: [], total: 0 });
  }
  const grants = await prisma.toolActionGrant.findMany({
    where: {
      sessionId: current.sessionId,
      toolName: "web_fetch",
      status: "pending",
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, decisionJson: true, createdAt: true },
  });
  return NextResponse.json({
    items: grants.map(grantToBatchItem),
    total: grants.length,
  });
}

/**
 * 批量决议同一会话内 pending 的 web_fetch。
 * 只用当前 grant 的 token 做入口校验，批处理范围固定为 session + web_fetch + pending。
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
    const current = await prisma.toolActionGrant.findUnique({ where: { id } });
    if (!current) {
      return NextResponse.json({ error: "审批记录不存在。" }, { status: 404 });
    }
    if (current.toolName !== "web_fetch") {
      return NextResponse.json(
        { error: "当前工具不支持批量审批。" },
        { status: 400 }
      );
    }
    if (!current.approvalTokenHash) {
      return NextResponse.json(
        { error: `审批已处理（${current.status}）。`, status: current.status },
        { status: 409 }
      );
    }
    if (
      !current.approvalTokenHash ||
      hashToken(parsed.data.approvalToken) !== current.approvalTokenHash
    ) {
      return NextResponse.json({ error: "令牌无效。" }, { status: 409 });
    }

    const targetIds = parsed.data.grantIds;
    const grants = await prisma.toolActionGrant.findMany({
      where: {
        sessionId: current.sessionId,
        toolName: "web_fetch",
        status: "pending",
        ...(targetIds?.length ? { id: { in: targetIds } } : {}),
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, decisionJson: true },
    });

    const trustedDomains = new Set<string>();
    if (decision === "allow") {
      for (const grant of grants) {
        const domain = await trustGrantDomain(grant.decisionJson);
        if (domain) trustedDomains.add(domain);
      }
    }

    let woken = 0;
    for (const grant of grants) {
      if (resolveApproval(grant.id, decision)) woken += 1;
    }

    const ids = grants.map((grant) => grant.id);
    if (ids.length) {
      await prisma.toolActionGrant.updateMany({
        where: { id: { in: ids } },
        data: {
          status: decision === "allow" ? "approved" : "rejected",
          approvalTokenHash: null,
        },
      });
    }
    const remaining = await prisma.toolActionGrant.count({
      where: {
        sessionId: current.sessionId,
        toolName: "web_fetch",
        status: "pending",
      },
    });
    if (remaining === 0) {
      await prisma.toolActionGrant.updateMany({
        where: {
          sessionId: current.sessionId,
          toolName: "web_fetch",
          status: { not: "pending" },
          approvalTokenHash: { not: null },
        },
        data: { approvalTokenHash: null },
      });
    }

    return NextResponse.json({
      ok: true,
      status: decision === "allow" ? "approved" : "rejected",
      count: ids.length,
      remaining,
      woken,
      trustedDomains: Array.from(trustedDomains),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "批量审批失败。" },
      { status: 500 }
    );
  }
}
