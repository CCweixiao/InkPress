import fs from "node:fs/promises";
import path from "node:path";
import {
  query,
  type Options,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { jsonrepair } from "jsonrepair";
import { z } from "zod";
import { chooseLlmConfig } from "@/lib/ai/llm-config";
import { claudeAgentRuntimeDir } from "@/lib/paths";

export const snippetAssessmentSchema = z.object({
  id: z.string(),
  verdict: z.enum(["matched", "insufficient"]),
  score: z.number().int().min(0).max(100),
  reason: z.string().min(1).max(300),
  suggestion: z.string().min(1).max(300),
});

export const snippetReviewAnalysisSchema = z.object({
  summary: z.string().min(1).max(500),
  assessments: z.array(snippetAssessmentSchema),
});

export type SnippetReviewAnalysis = z.infer<typeof snippetReviewAnalysisSchema>;

export function parseSnippetReviewAgentOutput(
  raw: string
): SnippetReviewAnalysis {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  const candidate =
    fenced || (start >= 0 && end > start ? trimmed.slice(start, end + 1) : "");
  try {
    const repaired = jsonrepair(candidate);
    return snippetReviewAnalysisSchema.parse(JSON.parse(repaired));
  } catch (cause) {
    throw new Error("灵感审核结果格式异常，请重新审核。", { cause });
  }
}

function textFromSdkMessage(message: SDKMessage): string {
  const raw = message as unknown as {
    type?: string;
    result?: string;
    message?: { content?: Array<{ type?: string; text?: string }> };
  };
  if (raw.type === "result" && typeof raw.result === "string") return raw.result;
  return (raw.message?.content ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("");
}

export async function reviewSnippetInjectionWithAi(input: {
  userText: string;
  currentArticle: string;
  recentConversation: string;
  snippets: Array<{
    id: string;
    title: string;
    content: string;
    tags: string[];
  }>;
  providerId?: string | null;
  modelId?: string | null;
}): Promise<SnippetReviewAnalysis> {
  const selected = await chooseLlmConfig(input.providerId, input.modelId);
  if (!selected?.apiKey) throw new Error("未配置可用的 AI 审核模型。");

  const runtimeDir = claudeAgentRuntimeDir();
  const configDir = path.join(runtimeDir, "snippet-review-config");
  const workspaceDir = path.join(runtimeDir, "snippet-review-workspace");
  await fs.mkdir(configDir, { recursive: true });
  await fs.mkdir(workspaceDir, { recursive: true });

  const options: Options = {
    env: {
      ...process.env,
      ANTHROPIC_BASE_URL: selected.baseUrl,
      ANTHROPIC_AUTH_TOKEN: selected.apiKey,
      ANTHROPIC_API_KEY: undefined,
      CLAUDE_AGENT_SDK_CLIENT_APP: "inkpress/snippet-review",
      CLAUDE_CONFIG_DIR: configDir,
    },
    model: selected.model.id,
    cwd: workspaceDir,
    systemPrompt: `你是 InkPress 的灵感素材审核子 Agent。只评估素材是否适合注入本轮写作，不生成文章。
逐条判断 matched（契合）或 insufficient（关联不足），评分 0-100。
综合用户本轮意图、当前文章和近期正式对话。不要因为关键词相同就机械给高分。
最终只输出合法 JSON，不要 Markdown，不要解释，结构为：
{"summary":"总体建议","assessments":[{"id":"素材ID","verdict":"matched|insufficient","score":0,"reason":"具体理由","suggestion":"使用或调整建议"}]}
输出前必须自行检查：属性之间有逗号，字符串中的换行和引号已转义，不能输出尾逗号。`,
    tools: [],
    settingSources: [],
    persistSession: false,
    maxTurns: 1,
  };
  const prompt = JSON.stringify({
    userText: input.userText,
    currentArticle: input.currentArticle.slice(0, 8000),
    recentConversation: input.recentConversation.slice(-4000),
    snippets: input.snippets.map((snippet) => ({
      ...snippet,
      content: snippet.content.slice(0, 4000),
    })),
  });

  let output = "";
  for await (const message of query({ prompt, options })) {
    const text = textFromSdkMessage(message as SDKMessage);
    if (text) output = text;
  }
  if (!output.trim()) throw new Error("灵感审核 Agent 未返回结果。");
  return parseSnippetReviewAgentOutput(output);
}
