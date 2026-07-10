import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { PENDING_APPROVAL_TTL_MS } from "@/lib/ai/pending-approvals";

export const runtime = "nodejs";

/** 供前端轮询以决定是否锁定 composer（mirror /api/ai/code-sources/[id]/status）。 */
export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const grant = await prisma.toolActionGrant.findUnique({ where: { id } });
  if (!grant) {
    return NextResponse.json({ error: "审批记录不存在。" }, { status: 404 });
  }
  let status = grant.status;
  if (
    status === "pending" &&
    Date.now() - grant.createdAt.getTime() > PENDING_APPROVAL_TTL_MS
  ) {
    await prisma.toolActionGrant
      .update({ where: { id }, data: { status: "expired", approvalTokenHash: null } })
      .catch(() => undefined);
    status = "expired";
  }
  return NextResponse.json({ status });
}
