import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DELETE /api/tasks/trash — 永久清空垃圾箱中的全部任务。 */
export async function DELETE() {
  try {
    await prisma.task.deleteMany({ where: { trashed: true } });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "清空垃圾箱失败" }, { status: 500 });
  }
}
