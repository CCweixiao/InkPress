import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const source = await prisma.codeSourceGrant.findUnique({
    where: { id },
    select: {
      id: true,
      kind: true,
      displayName: true,
      locator: true,
      ref: true,
      scope: true,
      status: true,
      approvedAt: true,
      lastAccessedAt: true,
    },
  });
  if (!source) return NextResponse.json({ error: "代码源不存在。" }, { status: 404 });
  return NextResponse.json({ source });
}
