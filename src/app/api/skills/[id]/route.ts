import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSkillDetail, updateSkill, deleteSkill } from "@/lib/skills-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  description: z.string().max(300).optional(),
  manual: z.string().max(200000).optional(),
});

/** 技能详情（用户可编辑，系统只读） */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const detail = await getSkillDetail(id);
  if (!detail) return NextResponse.json({ error: "技能不存在" }, { status: 404 });
  return NextResponse.json({ skill: detail });
}

/** 更新用户技能（系统技能不可改，返回 403） */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const detail = await getSkillDetail(id);
  if (!detail) return NextResponse.json({ error: "技能不存在" }, { status: 404 });
  if (!detail.editable) {
    return NextResponse.json({ error: "系统技能不可编辑" }, { status: 403 });
  }

  try {
    const updated = await updateSkill(id, parsed.data);
    if (!updated) return NextResponse.json({ error: "技能不存在" }, { status: 404 });
    return NextResponse.json({ skill: updated });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "更新失败" },
      { status: 500 }
    );
  }
}

/** 删除用户技能（系统技能不可删，返回 403） */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const detail = await getSkillDetail(id);
  if (!detail) return NextResponse.json({ error: "技能不存在" }, { status: 404 });
  if (!detail.editable) {
    return NextResponse.json({ error: "系统技能不可删除" }, { status: 403 });
  }
  const ok = await deleteSkill(id);
  if (!ok) return NextResponse.json({ error: "技能不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
