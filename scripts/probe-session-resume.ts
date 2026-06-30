// P5 探测：SessionStore resume —— 两轮对话验证 Claude 跨轮记忆。
//   INKPRESS_RATE_LIMIT_MAX_RETRIES=1 INKPRESS_RATE_LIMIT_RETRY_WAIT_MS=5000 \
//   DATABASE_URL=file:./dev.db pnpm tsx scripts/probe-session-resume.ts
import { runClaudeAgentRuntime } from "../src/lib/ai/claude-agent-runtime";
import { prisma } from "../src/lib/db";
import type { UIMessage } from "ai";

function makeWriter() {
  let text = "";
  const writer = {
    write: (part: never) => {
      const p = part as { type: string; delta?: string };
      if (p.type === "text-delta" && typeof p.delta === "string") text += p.delta;
    },
  };
  return { writer, getText: () => text };
}

function userMsg(text: string): UIMessage {
  return {
    id: crypto.randomUUID(),
    role: "user",
    parts: [{ type: "text", text }],
  } as unknown as UIMessage;
}

async function main() {
  const article = await prisma.article.findFirst({
    where: { trashed: false },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true },
  });
  if (!article) {
    console.error("[probe] 无文章");
    process.exit(1);
  }
  const session = await prisma.agentChatSession.upsert({
    where: { articleId: article.id },
    create: { articleId: article.id, targetKind: "article", runtime: "claude-agent" },
    update: { claudeAgentSessionId: null }, // 重置，确保首轮新会话
    select: { id: true },
  });
  const target = {
    kind: "article" as const,
    id: article.id,
    title: article.title,
    markdown: "",
  };

  // Round 1：新会话，告知名字
  console.log("[round1] 告知名字（新会话）…");
  const w1 = makeWriter();
  const o1 = await runClaudeAgentRuntime(
    {
      target,
      sessionId: session.id,
      messages: [userMsg("请记住：我的名字是 Alice。一句话确认即可。")],
    },
    w1.writer
  );
  const sdkId = o1.sessionId;
  console.log(
    "[round1] sdkSessionId=", sdkId,
    "| 回复:", w1.getText().slice(0, 80).replace(/\s+/g, " ")
  );

  const entryCount = sdkId
    ? await prisma.claudeAgentSessionEntry.count({
        where: { sdkSessionId: sdkId },
      })
    : 0;
  console.log(
    "[round1] SessionEntry 行数=", entryCount,
    entryCount > 0 ? "✅ 已镜像" : "❌ 未写入"
  );
  if (!sdkId || entryCount === 0) {
    console.error("[probe] ❌ 首轮未产生可 resume 的 session，中止。");
    return;
  }

  // 模拟 route 写回 sdkId
  await prisma.agentChatSession.update({
    where: { id: session.id },
    data: { claudeAgentSessionId: sdkId },
  });

  // Round 2：resume，问名字
  console.log("[round2] resume 问名字…");
  const w2 = makeWriter();
  await runClaudeAgentRuntime(
    {
      target,
      sessionId: session.id,
      claudeAgentSessionId: sdkId,
      messages: [userMsg("我叫什么名字？只回答名字。")],
    },
    w2.writer
  );
  const ans = w2.getText();
  console.log("[round2] 回复:", ans.slice(0, 80).replace(/\s+/g, " "));
  const ok = /alice/i.test(ans);
  console.log(
    ok ? "[probe] ✅ resume 生效：Claude 记得 Alice。" : "[probe] ❌ 未记得 Alice（resume 可能未生效）。"
  );

  // 清理：重置 session 的 sdkId（保留 entries 留作跨进程验证）
  await prisma.agentChatSession.update({
    where: { id: session.id },
    data: { claudeAgentSessionId: null },
  });
}

main().catch((e) => {
  console.error("[probe] 失败:", e);
  process.exit(1);
});
