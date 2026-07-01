import { NextRequest, NextResponse } from "next/server";
import { removeAllowedDomain } from "@/lib/ai/web-allowlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DELETE /api/ai/web-allowlist/[id] 删除一条白名单域名。 */
export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  try {
    await removeAllowedDomain(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Prisma P2025 = 记录不存在
    if ((err as { code?: string })?.code === "P2025") {
      return NextResponse.json({ error: "记录不存在。" }, { status: 404 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "删除失败。" },
      { status: 500 }
    );
  }
}
