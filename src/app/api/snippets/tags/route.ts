import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { countTagsByUsage } from "@/lib/snippets/tag-repo";
import { TAG_COLOR_NAMES } from "@/lib/snippets/tag-colors";
import { getTagColors, setTagColor } from "@/lib/snippets/tag-color-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 获取所有标签（去重 + 计数 + 颜色） */
export async function GET() {
  const [tagCounts, tagColors] = await Promise.all([
    countTagsByUsage(),
    getTagColors(),
  ]);
  const tags = tagCounts.map((t) => ({ ...t, color: tagColors[t.name] ?? null }));
  return NextResponse.json({ tags });
}

const patchSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.enum(TAG_COLOR_NAMES).nullable(),
});

/** 设置/清除某标签的颜色 */
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数无效", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { name, color } = parsed.data;
  const tagColors = await setTagColor(name, color);
  return NextResponse.json({ tagColors });
}
