import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withApiLog, logMutation } from "@/lib/api-log";

const updateSchema = z.object({
  name: z.string().min(1).max(20).optional(),
  cssContent: z.string().min(1).optional(),
  codeTheme: z.string().optional(),
  primaryColor: z.string().optional(),
  isDefault: z.boolean().optional(),
});

type Params = { params: Promise<{ id: string }> };

export const PUT = withApiLog("PUT /api/themes/[id]", async (req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { isDefault, ...rest } = parsed.data;

  // 设为默认：事务内先把其他主题的 isDefault 置 false，再把目标置 true（保证至多一个默认）
  if (isDefault) {
    const theme = await prisma.$transaction(async (tx) => {
      await tx.theme.updateMany({ data: { isDefault: false } });
      return tx.theme.update({ where: { id }, data: { ...rest, isDefault: true } });
    });
    logMutation("theme", "setDefault", { id });
    return NextResponse.json({ theme });
  }

  // 取消默认：拒绝取消当前唯一的默认主题（保证至少一个默认）
  if (isDefault === false) {
    const current = await prisma.theme.findUnique({ where: { id } });
    if (current?.isDefault) {
      const otherDefaults = await prisma.theme.count({
        where: { isDefault: true, NOT: { id } },
      });
      if (otherDefaults === 0) {
        return NextResponse.json(
          { error: "至少需要保留一个默认主题" },
          { status: 400 }
        );
      }
    }
  }

  const theme = await prisma.theme.update({ where: { id }, data: rest });
  logMutation("theme", "update", { id, name: theme.name });
  return NextResponse.json({ theme });
});

export const DELETE = withApiLog("DELETE /api/themes/[id]", async (_req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const theme = await prisma.theme.findUnique({ where: { id } });
  if (theme?.isBuiltIn) {
    return NextResponse.json(
      { error: "内置主题不可删除" },
      { status: 400 }
    );
  }
  // 防御：被文章引用的主题不可删除（避免外键悬空）
  const refCount = await prisma.article.count({
    where: { themeId: id, trashed: false },
  });
  if (refCount > 0) {
    return NextResponse.json(
      { error: `该主题被 ${refCount} 篇文章使用，无法删除` },
      { status: 400 }
    );
  }
  // 删除的是默认主题时，把默认转移给第一个内置主题
  if (theme?.isDefault) {
    await prisma.$transaction(async (tx) => {
      await tx.theme.delete({ where: { id } });
      const fallback = await tx.theme.findFirst({
        where: { isBuiltIn: true },
        orderBy: { createdAt: "asc" },
      });
      if (fallback) {
        await tx.theme.update({ where: { id: fallback.id }, data: { isDefault: true } });
      }
    });
  } else {
    await prisma.theme.delete({ where: { id } });
  }
  logMutation("theme", "delete", { id, wasDefault: theme?.isDefault ?? false });
  return NextResponse.json({ ok: true });
});
