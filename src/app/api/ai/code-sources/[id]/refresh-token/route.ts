import { NextResponse } from "next/server";
import { refreshCodeSourceApprovalToken } from "@/lib/ai/code-source";

export const runtime = "nodejs";

/** 为 pending grant 重新签发 approvalToken（客户端 token 失效时的恢复入口）。 */
export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  try {
    const { approvalToken } = await refreshCodeSourceApprovalToken(id);
    return NextResponse.json({ ok: true, approvalToken });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "刷新授权令牌失败。" },
      { status: 409 }
    );
  }
}
