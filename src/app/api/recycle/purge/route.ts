import { NextResponse } from "next/server";
import { z } from "zod";
import { purgeArticle, purgeAsset, purgeSpace } from "@/lib/recycle";

export const runtime = "nodejs";

const itemType = z.enum(["article", "space", "asset"]);

// 兼容两种入参：单删 { type, id } 或 批删 { items: [{type,id}...] }
const singleSchema = z.object({ type: itemType, id: z.string().min(1) });
const batchSchema = z.object({
  items: z.array(singleSchema).min(1),
});

async function purgeOne(type: "article" | "space" | "asset", id: string) {
  if (type === "article") await purgeArticle(id);
  else if (type === "space") await purgeSpace(id);
  else await purgeAsset(id);
}

/** 彻底删除回收站项（真删：文章删文件、素材删 OSS）。支持单个或批量。 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  // 优先尝试批量
  const batch = batchSchema.safeParse(body);
  if (batch.success) {
    for (const { type, id } of batch.data.items) {
      await purgeOne(type, id);
    }
    return NextResponse.json({ ok: true, count: batch.data.items.length });
  }

  // 单删
  const single = singleSchema.safeParse(body);
  if (!single.success) {
    return NextResponse.json({ error: "参数无效" }, { status: 400 });
  }
  const { type, id } = single.data;
  await purgeOne(type, id);
  return NextResponse.json({ ok: true });
}
