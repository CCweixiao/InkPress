import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getOrCreateAgentSession,
  loadAllAgentMessages,
  type AgentTarget,
} from "@/lib/ai/chat-persistence";
import { getModel } from "@/lib/ai/provider";
import {
  estimateTokens,
  estimateMessageTokens,
  summarizeConversation,
} from "@/lib/ai/context-manager";
import { withApiLog } from "@/lib/api-log";
import { classifyError } from "@/lib/ai/error-classify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const targetSchema = z.object({
  kind: z.enum(["article", "technical-document"]),
  id: z.string().min(1),
});

const bodySchema = z.object({
  target: targetSchema,
  providerId: z.string().optional().nullable(),
  modelId: z.string().optional().nullable(),
});

// 手动压缩保留的最近消息数（比自动压缩更激进，腾出更多上下文）。
const COMPACT_KEEP_RECENT = 4;

/**
 * 手动压缩对话（斜杠命令 /compact）：无视预算阈值，立即把历史压缩进 session.summary，
 * 保留最近 COMPACT_KEEP_RECENT 条原文。返回压缩条数与压缩前后 token 估算，供前端反馈。
 */
export const POST = withApiLog("POST /api/ai/chat/compact", async (req: NextRequest) => {
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "参数无效。" }, { status: 400 });
  }

  const target = parsed.data.target as AgentTarget;
  const session = await getOrCreateAgentSession(target);
  const messages = await loadAllAgentMessages(session.id);

  // 统一口径：与 context-manager / TokenMeter 一致，含 text + 完整工具 input/output，
  // 避免「仅 text part」低估导致前端展示的「约省 X tokens」与 TokenMeter 下降值对不上。
  const beforeTokens = messages.reduce(
    (total, message) => total + estimateMessageTokens(message),
    0
  );

  try {
    const { model } = await getModel(parsed.data.providerId, parsed.data.modelId);
    const result = await summarizeConversation({
      model,
      sessionId: session.id,
      summary: session.summary,
      summaryUpToPosition: session.summaryUpToPosition,
      uiMessages: messages,
      keepRecent: COMPACT_KEEP_RECENT,
      deleteSummarized: true,
    });

    const kept = messages.slice(-COMPACT_KEEP_RECENT);
    const afterTokens =
      estimateTokens(result.summary) +
      kept.reduce(
        (total, message) => total + estimateMessageTokens(message),
        0
      );

    return NextResponse.json({
      ok: true,
      summarizedCount: result.summarizedCount,
      summaryPreview: result.summary.slice(0, 200),
      beforeTokens,
      afterTokens,
      totalMessages: messages.length,
      keptMessages: kept.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: classifyError(error).label, raw: classifyError(error).raw },
      { status: 500 }
    );
  }
});
