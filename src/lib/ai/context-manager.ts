import {
  convertToModelMessages,
  generateText,
  pruneMessages,
  type LanguageModel,
  type ModelMessage,
  type UIMessage,
} from "ai";
import { prisma } from "@/lib/db";

const RECENT_MESSAGE_COUNT = 8;
const MAX_SUMMARY_SOURCE_CHARS = 24_000;

export function estimateTokens(text: string) {
  const cjk = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  const nonCjk = Math.max(0, text.length - cjk);
  return Math.ceil(cjk / 1.5 + nonCjk / 4);
}

function messageText(message: UIMessage) {
  return (message.parts ?? [])
    .filter(
      (part): part is { type: "text"; text: string } =>
        part.type === "text" && typeof part.text === "string"
    )
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function compactTranscript(messages: UIMessage[]) {
  return messages
    .map((message) => {
      const text = messageText(message);
      if (!text) return null;
      return `${message.role === "user" ? "用户" : "助手"}：${text.slice(0, 1800)}`;
    })
    .filter(Boolean)
    .join("\n\n")
    .slice(-MAX_SUMMARY_SOURCE_CHARS);
}

export async function prepareAgentContext(input: {
  model: LanguageModel;
  sessionId: string;
  sessionSummary: string;
  summaryUpToPosition: number;
  uiMessages: UIMessage[];
  articleText: string;
  contextBudgetTokens: number;
}) {
  const articleTokens = estimateTokens(input.articleText);
  if (articleTokens > input.contextBudgetTokens * 0.65) {
    throw new Error(
      `当前文章约 ${articleTokens.toLocaleString()} tokens，已超过写作助手安全上下文预算。请切换支持更长上下文的模型，或先精简文章后再继续。`
    );
  }

  const conversationTokens = input.uiMessages.reduce(
    (total, message) => total + estimateTokens(messageText(message)),
    0
  );
  const estimatedTokens =
    articleTokens + estimateTokens(input.sessionSummary) + conversationTokens;
  const shouldSummarize =
    input.uiMessages.length > 24 ||
    estimatedTokens > input.contextBudgetTokens * 0.7;

  let summary = input.sessionSummary;
  let summaryUpToPosition = input.summaryUpToPosition;
  let recentMessages = input.uiMessages;

  if (shouldSummarize && input.uiMessages.length > RECENT_MESSAGE_COUNT) {
    const cutoff = input.uiMessages.length - RECENT_MESSAGE_COUNT;
    const newHistorical = input.uiMessages.slice(
      Math.max(0, input.summaryUpToPosition + 1),
      cutoff
    );
    if (newHistorical.length > 0) {
      const transcript = compactTranscript(newHistorical);
      const result = await generateText({
        model: input.model,
        system: `你负责压缩写作对话历史。输出简洁的结构化中文摘要，严格保留：
- 用户最终目标与受众
- 已确认的写作要求
- 已验证事实和来源 URL
- 已做出的文章决策
- 尚未完成或待确认事项
不要保留工具执行噪声、寒暄或已经被推翻的方案。`,
        prompt: `已有摘要：\n${summary || "（无）"}\n\n新增历史：\n${transcript}`,
        temperature: 0,
        maxOutputTokens: 1200,
        maxRetries: 1,
      });
      summary = result.text.trim();
      summaryUpToPosition = cutoff - 1;
      await prisma.agentChatSession.update({
        where: { id: input.sessionId },
        data: { summary, summaryUpToPosition },
      });
    }
    recentMessages = input.uiMessages.slice(-RECENT_MESSAGE_COUNT);
  }

  const converted = await convertToModelMessages(recentMessages);
  const messages = pruneMessages({
    messages: converted,
    reasoning: "all",
    toolCalls: "before-last-2-messages",
    emptyMessages: "remove",
  }) as ModelMessage[];

  return {
    summary,
    summaryUpToPosition,
    messages,
    estimatedTokens,
    articleTokens,
    compressed: shouldSummarize && input.uiMessages.length > RECENT_MESSAGE_COUNT,
    retainedMessages: recentMessages.length,
  };
}
