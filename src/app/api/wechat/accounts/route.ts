import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto/secret-store";

const createSchema = z.object({ name: z.string().trim().min(1).max(60), appId: z.string().trim().min(1).max(100), secret: z.string().trim().min(1).max(300), tags: z.array(z.string().trim().min(1).max(30)).max(20).default([]), isDefault: z.boolean().optional() });
export async function GET() {
  try {
    const accounts = await prisma.wechatAccount.findMany({ orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }], select: { id: true, name: true, appId: true, tagsJson: true, isDefault: true, status: true, lastError: true, lastCheckedAt: true, createdAt: true, updatedAt: true } });
    return NextResponse.json({ accounts });
  } catch (error) {
    return NextResponse.json({ error: "公众号账号数据尚未完成升级，请重启应用后重试。", detail: error instanceof Error ? error.message : undefined }, { status: 503 });
  }
}
export async function POST(req: NextRequest) {
  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const input = parsed.data;
  try {
    const account = await prisma.$transaction(async (tx) => {
      const isDefault = input.isDefault || (await tx.wechatAccount.count()) === 0;
      if (isDefault) await tx.wechatAccount.updateMany({ data: { isDefault: false } });
      return tx.wechatAccount.create({ data: { name: input.name, appId: input.appId, secret: encryptSecret(input.secret), tagsJson: JSON.stringify(input.tags), isDefault } });
    });
    const { secret: _secret, ...safe } = account;
    return NextResponse.json({ account: safe }, { status: 201 });
  } catch { return NextResponse.json({ error: "AppID 已存在，或账号保存失败。" }, { status: 400 }); }
}
