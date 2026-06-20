import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "@/lib/ai/provider";
import { OUTLINE_SYSTEM_PROMPT, buildOutlineMessage } from "@/lib/ai/prompts";
import { outlineSchema } from "@/lib/ai/schema";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.object({
  topic: z.string().min(1, "请填写文章主题"),
  requirements: z.string().optional(),
  materials: z.string().optional(),
});

/** 生成文章大纲（结构化对象） */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const { object } = await generateObject({
      model: getModel(),
      schema: outlineSchema,
      system: OUTLINE_SYSTEM_PROMPT,
      prompt: buildOutlineMessage(parsed.data),
    });
    return NextResponse.json({ outline: object });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "大纲生成失败" },
      { status: 500 }
    );
  }
}
