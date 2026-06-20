import { NextRequest } from "next/server";
import { streamText } from "ai";
import { z } from "zod";
import { getModel } from "@/lib/ai/provider";
import { SYSTEM_PROMPT, buildUserMessage } from "@/lib/ai/prompts";

export const runtime = "nodejs";
// AI 流式生成需要较长执行时间
export const maxDuration = 60;

const schema = z.object({
  topic: z.string().min(1, "请填写文章主题"),
  requirements: z.string().optional(),
  materials: z.string().optional(),
  length: z.string().optional(),
});

/**
 * 流式生成公众号文章（Markdown 文本流）
 * 配合前端 useCompletion（默认 text streamProtocol）
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: parsed.error.flatten() }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  let model;
  try {
    model = getModel();
  } catch (e) {
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "模型加载失败",
      }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }

  const result = streamText({
    model,
    system: SYSTEM_PROMPT,
    prompt: buildUserMessage(parsed.data),
    maxOutputTokens: 4096,
    onError: ({ error }) => {
      console.error("[ai/generate] stream error:", error);
    },
  });

  return result.toTextStreamResponse();
}
