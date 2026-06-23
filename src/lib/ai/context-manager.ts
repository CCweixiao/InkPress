import {
  convertToModelMessages,
  generateText,
  pruneMessages,
  type LanguageModel,
  type ModelMessage,
  type UIMessage,
} from "ai";
import { prisma } from "@/lib/db";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("ai.context");

const RECENT_MESSAGE_COUNT = 8;
const MAX_SUMMARY_SOURCE_CHARS = 24_000;

export function estimateTokens(text: string) {
  const cjk = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  const nonCjk = Math.max(0, text.length - cjk);
  return Math.ceil(cjk / 1.5 + nonCjk / 4);
}

/** 提取消息的可估算文本（用于 token 估算）。
 *  包含 text part + 工具调用的 input/output 文本，使 conversationTokens 更接近实际上下文大小，
 *  让 shouldSummarize 阈值在工具调用密集的对话中也能正确触发。 */
function messageText(message: UIMessage) {
  return (message.parts ?? [])
    .map((part) => {
      const p = part as Record<string, unknown>;
      if (p.type === "text" && typeof p.text === "string") {
        return p.text;
      }
      // 工具调用 / 结果 part：提取 input 和 output 中的大文本字段
      if (
        (typeof p.type === "string" && p.type.startsWith("tool-")) ||
        p.type === "dynamic-tool"
      ) {
        const segments: string[] = [];
        const input = p.input;
        if (input && typeof input === "object") {
          for (const key of ["markdown", "summary", "text", "digest", "title"]) {
            const val = (input as Record<string, unknown>)[key];
            if (typeof val === "string") segments.push(val);
          }
        }
        const output = p.output;
        if (output && typeof output === "object") {
          for (const key of ["markdown", "summary", "text", "digest", "title"]) {
            const val = (output as Record<string, unknown>)[key];
            if (typeof val === "string") segments.push(val);
          }
        }
        return segments.join("\n");
      }
      return "";
    })
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

const SUMMARY_SYSTEM = `你负责压缩写作对话历史。输出简洁的结构化中文摘要，严格保留：
- 用户最终目标与受众
- 已确认的写作要求
- 已验证事实和来源 URL
- 已做出的文章决策
- 用户透露的偏好、约定与经验（写作风格、术语、禁忌）
- 尚未完成或待确认事项
不要保留工具执行噪声、寒暄或已经被推翻的方案。`;

/**
 * 压缩对话历史为摘要（auto 自动触发与 /compact 手动触发共用）。
 * 保留最近 keepRecent 条消息不压缩，将其余未压缩历史并入 session.summary，
 * 持久化 summary + summaryUpToPosition。返回压缩条数（0 = 无可压缩）。
 *
 * deleteSummarized（默认 false）：当 true 时，删除已被摘要覆盖的旧消息并对剩余消息
 * position 重编号（从 0 连续）。仅手动 /compact 使用——自动压缩路径不能删消息，
 * 因为后续 onFinish 的 saveAgentMessages 会用压缩前的完整列表覆盖 DB。
 */
export async function summarizeConversation(input: {
  model: LanguageModel;
  sessionId: string;
  summary: string;
  summaryUpToPosition: number;
  uiMessages: UIMessage[];
  keepRecent?: number;
  deleteSummarized?: boolean;
}): Promise<{
  summary: string;
  summaryUpToPosition: number;
  summarizedCount: number;
}> {
  const keepRecent = input.keepRecent ?? RECENT_MESSAGE_COUNT;
  const cutoff = Math.max(0, input.uiMessages.length - keepRecent);
  if (cutoff === 0) {
    return {
      summary: input.summary,
      summaryUpToPosition: input.summaryUpToPosition,
      summarizedCount: 0,
    };
  }
  const newHistorical = input.uiMessages.slice(
    Math.max(0, input.summaryUpToPosition + 1),
    cutoff
  );
  if (newHistorical.length === 0) {
    return {
      summary: input.summary,
      summaryUpToPosition: input.summaryUpToPosition,
      summarizedCount: 0,
    };
  }
  const transcript = compactTranscript(newHistorical);
  const result = await generateText({
    model: input.model,
    system: SUMMARY_SYSTEM,
    prompt: `已有摘要：\n${input.summary || "（无）"}\n\n新增历史：\n${transcript}`,
    temperature: 0,
    maxOutputTokens: 1200,
    maxRetries: 1,
  });
  const summary = result.text.trim();

  if (input.deleteSummarized) {
    // 删除已被摘要覆盖的旧消息，剩余消息 position 批量减 cutoff 使其从 0 开始连续。
    // summaryUpToPosition 重置为 -1（所有保留消息都已在 DB 中，无跳过的前缀）。
    await prisma.$transaction([
      prisma.agentChatMessage.deleteMany({
        where: { sessionId: input.sessionId, position: { lte: cutoff - 1 } },
      }),
      prisma.agentChatMessage.updateMany({
        where: { sessionId: input.sessionId },
        data: { position: { decrement: cutoff } },
      }),
      prisma.agentChatSession.update({
        where: { id: input.sessionId },
        data: { summary, summaryUpToPosition: -1 },
      }),
    ]);
    return { summary, summaryUpToPosition: -1, summarizedCount: newHistorical.length };
  }

  const summaryUpToPosition = cutoff - 1;
  await prisma.agentChatSession.update({
    where: { id: input.sessionId },
    data: { summary, summaryUpToPosition },
  });
  return { summary, summaryUpToPosition, summarizedCount: newHistorical.length };
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
  // 阈值判断基于全量消息（判断是否需要压缩），不使用 retained——否则压缩后 estimatedTokens
  // 下降会导致 shouldSummarize 为 false，永远无法触发自动压缩。
  const shouldSummarize =
    input.uiMessages.length > 24 ||
    articleTokens + estimateTokens(input.sessionSummary) + conversationTokens >
      input.contextBudgetTokens * 0.7;

  let summary = input.sessionSummary;
  let summaryUpToPosition = input.summaryUpToPosition;
  let recentMessages = input.uiMessages;

  if (shouldSummarize && input.uiMessages.length > RECENT_MESSAGE_COUNT) {
    const compressed = await summarizeConversation({
      model: input.model,
      sessionId: input.sessionId,
      summary: input.sessionSummary,
      summaryUpToPosition: input.summaryUpToPosition,
      uiMessages: input.uiMessages,
    });
    summary = compressed.summary;
    summaryUpToPosition = compressed.summaryUpToPosition;
    recentMessages = input.uiMessages.slice(-RECENT_MESSAGE_COUNT);
  }

  // estimatedTokens 基于实际将发送给 LLM 的 retained messages + summary + article，
  // 反映压缩后真实占用（而非全量历史），使前端 TokenMeter 在压缩后正确下降。
  const retainedTokens = recentMessages.reduce(
    (total, message) => total + estimateTokens(messageText(message)),
    0
  );
  const estimatedTokens =
    articleTokens + estimateTokens(summary) + retainedTokens;

  const converted = await convertToModelMessages(recentMessages);
  // 选择性裁剪：只对「重型工具」裁剪旧调用，其余工具全部保留。
  //
  // propose_article_revision 的 input.markdown 包含完整正文，web_extract 的 output 包含整页内容。
  // 若全部保留（"none"），N 轮修改 = N 份完整正文副本 + 系统提示词 1 份 → 上下文膨胀。
  //
  // 选择性裁剪策略：
  // - propose_*_revision / web_extract：仅保留最近 2 条消息中的调用，更早的裁剪
  //   （旧的正文副本被移除，但系统提示词始终有当前正文兜底）
  // - explore_project / web_search / 等轻量工具：全部保留（"none" 效果），不丢多轮上下文
  // - 非 tool-call part（text / reasoning）：始终保留
  const messages = pruneMessages({
    messages: converted,
    reasoning: "all",
    toolCalls: [
      {
        type: "before-last-2-messages",
        tools: [
          "propose_article_revision",
          "propose_technical_document_revision",
          "web_extract",
        ],
      },
    ],
    emptyMessages: "remove",
  }) as ModelMessage[];

  // 诊断日志：追踪消息在各阶段的数量变化
  log.debug(
    {
      sessionId: input.sessionId,
      uiMessagesCount: input.uiMessages.length,
      recentMessagesCount: recentMessages.length,
      convertedCount: converted.length,
      prunedCount: messages.length,
    },
    "prepareAgentContext 消息流"
  );

  const compressed =
    shouldSummarize && input.uiMessages.length > RECENT_MESSAGE_COUNT;

  log.debug(
    {
      sessionId: input.sessionId,
      articleTokens,
      conversationTokens,
      estimatedTokens,
      budget: input.contextBudgetTokens,
      compressed,
      retainedMessages: recentMessages.length,
      totalMessages: input.uiMessages.length,
    },
    compressed ? "上下文已压缩" : "上下文未压缩"
  );

  return {
    summary,
    summaryUpToPosition,
    messages,
    estimatedTokens,
    articleTokens,
    compressed,
    retainedMessages: recentMessages.length,
  };
}
