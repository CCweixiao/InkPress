import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listAllSkills, createSkill } from "@/lib/skills-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 列出全部技能（用户 + 系统） */
export async function GET() {
  try {
    const skills = await listAllSkills();
    return NextResponse.json({ skills });
  } catch (e) {
    // 返回可读错误而非空 500，便于排查（常见原因：Prisma 客户端未重新生成 / dev 缓存陈旧）
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? `技能加载失败：${e.message}。若刚新增 Skill 表，请重启 dev 服务器。`
            : "技能加载失败",
      },
      { status: 500 }
    );
  }
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().max(300).default(""),
  manual: z.string().max(200000).default(""),
  promptHint: z.string().max(500).nullable().optional(),
});

/** 新建用户技能（手动新建 / AI 生成确认保存均走此入口） */
export async function POST(req: NextRequest) {
  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const skill = await createSkill(parsed.data);
    return NextResponse.json({ skill }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "创建失败" },
      { status: 500 }
    );
  }
}
