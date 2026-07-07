import { NextResponse } from "next/server";
import { revokeCodeSourceGrant } from "@/lib/ai/code-source";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const result = await revokeCodeSourceGrant(id);
  if (!result.count) {
    return NextResponse.json({ error: "代码源不存在或已经撤销。" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
