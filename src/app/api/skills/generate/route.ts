import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateText } from "ai";
import { getModel } from "@/lib/ai/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const schema = z.object({
  prompt: z.string().trim().min(1).max(2000),
  providerId: z.string().optional(),
  modelId: z.string().optional(),
});

/**
 * AI 生成一个 SKILL.md 草稿（不落库）。
 * 方法论参考 OpenAI skill-creator：渐进式披露、声明式 YAML frontmatter、
 * 明确的触发场景（when-to-use 写在 description）、指令精简可执行、避免冗余。
 * 产出后交前端预览编辑，确认后再 POST /api/skills 保存。
 */
export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  let model;
  try {
    model = (await getModel(parsed.data.providerId, parsed.data.modelId)).model;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "模型加载失败" },
      { status: 500 }
    );
  }

  const system = `你是「技能设计专家」，负责为公众号写作平台设计可复用的写作技能（Skill）。

技能是 Markdown 指令文件，会被写作助手加载，在合适的写作场景下自动应用。设计原则：

1. **简洁优先**：上下文窗口是公共资源。模型已经很聪明，只补充它不具备的领域知识。每一段都要值得其 token 成本，多举例少说教。
2. **声明式 frontmatter**：YAML 头只有 name 和 description 两个字段。description 是唯一的触发依据，必须同时写清「这个技能做什么」和「什么场景该用它」。
3. **指令用祈使句**：正文是给 AI 的操作手册，使用祈使句（「先确认…再…」「避免…」），不要写「你应该」「我们需要」。
4. **可执行**：给出明确的步骤、判断标准、输出格式，避免空泛口号。
5. **避免冗余**：不要 README、不要说明文档、不要解释这个技能是怎么被创建的。只保留 AI 完成任务所需的最少内容。

输出格式（严格遵守，不要任何前后缀解释、不要代码块包裹）：

---
name: <lowercase-kebab-case，动词短语，≤40 字符>
description: <一句话说明用途 + 适用的写作场景，明确触发条件，≤80 字>
---
# <技能标题>

<正文：操作流程、判断标准、注意事项、输出格式要求。200-600 字为宜。>`;

  try {
    const { text } = await generateText({
      model,
      system,
      prompt: `请为以下用途设计一个写作技能，输出完整的 SKILL.md：\n\n${parsed.data.prompt}`,
    });

    // 解析 frontmatter，拆分出 name/description/manual
    const result = parseGeneratedSkill(text);
    if (!result) {
      return NextResponse.json(
        { error: "生成内容格式异常，请重试或手动编辑", raw: text },
        { status: 500 }
      );
    }
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "生成失败" },
      { status: 500 }
    );
  }
}

function parseGeneratedSkill(raw: string) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;
  const metadata = match[1];
  const manual = match[2].trim();
  const values = new Map<string, string>();
  for (const line of metadata.split("\n")) {
    const sep = line.indexOf(":");
    if (sep < 0) continue;
    values.set(line.slice(0, sep).trim(), line.slice(sep + 1).trim());
  }
  const name = values.get("name") || "";
  const description = values.get("description") || "";
  if (!name || !description) return null;
  return { name, description, manual };
}
