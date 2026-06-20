import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const updateSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  cssContent: z.string().optional(),
  codeTheme: z.string().optional(),
  primaryColor: z.string().optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const theme = await prisma.theme.update({ where: { id }, data: parsed.data });
  return NextResponse.json({ theme });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const theme = await prisma.theme.findUnique({ where: { id } });
  if (theme?.isBuiltIn) {
    return NextResponse.json(
      { error: "内置主题不可删除" },
      { status: 400 }
    );
  }
  await prisma.theme.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
