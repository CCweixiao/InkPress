import { NextRequest } from "next/server";
import { streamText } from "ai";
import { z } from "zod";
import { getModel } from "@/lib/ai/provider";
import {
  SECTION_SYSTEM_PROMPT,
  buildSectionMessage,
} from "@/lib/ai/prompts";
import type { Outline } from "@/lib/ai/schema";

export const runtime = "nodejs";
export const maxDuration = 300; // 多节串行，给足时间

const schema = z.object({
  outline: z.object({
    title: z.string(),
    sections: z.array(z.object({ heading: z.string(), summary: z.string() })),
  }),
  requirements: z.string().optional(),
  materials: z.string().optional(),
});

/**
 * 分节流式生成：依据大纲逐节生成并拼接。
 * 流协议：每节开始前输出一个哨兵行 `<section index="i" total="n" heading="..."/>`，
 * 客户端据此更新进度。最终是完整 Markdown。
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: parsed.error.flatten() }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const { outline, requirements, materials } = parsed.data;

  let model;
  try {
    model = getModel();
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "模型加载失败" }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }

  const total = outline.sections.length;
  const context = { requirements, materials };

  // 用 ReadableStream 串行拼接各节流
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // 标题
      controller.enqueue(encoder.encode(`# ${outline.title}\n\n`));

      for (let i = 0; i < total; i++) {
        const section = outline.sections[i];
        // 哨兵：客户端据此显示进度
        const sentinel = `<section index="${i + 1}" total="${total}" heading="${escapeAttr(
          section.heading
        )}"/>\n`;
        controller.enqueue(encoder.encode(sentinel));

        try {
          const result = streamText({
            model,
            system: SECTION_SYSTEM_PROMPT,
            prompt: buildSectionMessage(outline.title, section, context),
            maxOutputTokens: 1200,
            onError: ({ error }) => console.error("[section] error:", error),
          });

          for await (const delta of result.textStream) {
            controller.enqueue(encoder.encode(delta));
          }
          controller.enqueue(encoder.encode("\n\n"));
        } catch (e) {
          controller.enqueue(
            encoder.encode(
              `\n\n> [本节生成失败：${e instanceof Error ? e.message : "未知错误"}]\n\n`
            )
          );
        }
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-cache",
    },
  });
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type { Outline };
