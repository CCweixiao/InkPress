// E2E 探测：buildClaudeAgentOptions（含 canUseTool 闸门）+ blocking-Promise 桥。
// 真实 GLM 调 set_article_digest（ASK）→ emit data-tool-approval → 探测脚本用 resolveApproval
// 模拟用户「同意」→ canUseTool 解阻塞 → 工具执行（写摘要到 DB）→ 校验摘要已变更。
//
//   DATABASE_URL=file:./dev.db pnpm tsx scripts/probe-approval-bridge.ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { prisma } from "../src/lib/db";
import { buildClaudeAgentOptions } from "../src/lib/ai/claude-agent-options";
import { resolveApproval } from "../src/lib/ai/pending-approvals";
import { claudeAllowedTools } from "../src/lib/ai/permission-engine";

async function main() {
  const article = await prisma.article.findFirst({
    where: { trashed: false },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, digest: true },
  });
  if (!article) {
    console.error("[probe] dev.db 无文章");
    process.exit(1);
  }
  const originalDigest = article.digest ?? null;
  console.log(
    "[probe] target:", article.id, "| title:", article.title,
    "| digest before:", JSON.stringify(originalDigest)
  );

  // 先清空摘要：给模型一个明确的「需要写入」信号，避免它看到已有摘要就直接文本回复。
  await prisma.article.update({
    where: { id: article.id },
    data: { digest: null },
  });

  const sessionId = `probe-approval-${article.id}`;
  console.log("[probe] allowedTools:", claudeAllowedTools());
  console.log(
    "[probe] set_article_digest 在 allowedTools?",
    claudeAllowedTools().includes("mcp__inkpress__set_article_digest")
  );

  // 用真实 AgentChatSession（ToolActionGrant.sessionId 有 FK 约束，假 id 会让 create 抛错）。
  const session = await prisma.agentChatSession.upsert({
    where: { articleId: article.id },
    create: { articleId: article.id, targetKind: "article", runtime: "claude-agent" },
    update: { runtime: "claude-agent" },
    select: { id: true },
  });
  const realSessionId = session.id;
  let approvalSeen: {
    grantId: string;
    approvalToken: string;
    digest: string;
  } | null = null;

  const options = await buildClaudeAgentOptions({
    target: {
      kind: "article",
      id: article.id,
      title: article.title,
      markdown:
        "Claude Agent SDK 让开发者把 Claude 的编程与推理能力嵌入程序，支持工具循环、流式输出与权限管理。",
      digest: originalDigest ?? undefined,
    },
    sessionId: realSessionId,
    emit: (part) => {
      const p = part as unknown as {
        type: string;
        data?: Record<string, unknown>;
      };
      if (p.type === "data-tool-approval" && p.data) {
        const input = (p.data.input ?? {}) as Record<string, unknown>;
        approvalSeen = {
          grantId: String(p.data.grantId ?? ""),
          approvalToken: String(p.data.approvalToken ?? ""),
          digest: String(input.digest ?? ""),
        };
        console.log(
          "[emit] data-tool-approval grantId=", approvalSeen.grantId,
          "| digest=", approvalSeen.digest.slice(0, 60)
        );
        // 模拟用户决定（argv[2]="reject" → 拒绝，否则同意）：稍后唤醒 blocking-Promise。
        const decision = process.argv[2] === "reject" ? "deny" : "allow";
        setTimeout(() => {
          const woken = resolveApproval(approvalSeen!.grantId, decision);
          console.log(`[probe] resolveApproval(${decision}) woken=`, woken);
        }, 600);
      }
    },
  });

  const ac = new AbortController();
  for await (const msg of query({
    prompt:
      "请调用 mcp__inkpress__set_article_digest 工具，为这篇文章生成一句话摘要并写入摘要字段。",
    options: { ...options, abortController: ac, maxTurns: 4 },
  }) as AsyncIterable<{
    type: string;
    subtype?: string;
    message?: {
      content?: Array<{
        type: string;
        name?: string;
        input?: unknown;
        is_error?: boolean;
        content?: unknown;
      }>;
    };
  }>) {
    if (msg.type === "assistant") {
      for (const b of msg.message?.content ?? []) {
        if (b.type === "tool_use") {
          console.log("[assistant] tool_use:", b.name);
        } else if (b.type === "text") {
          console.log(
            "[assistant] text:",
            String((b as { text?: string }).text ?? "").slice(0, 160)
          );
        } else {
          console.log("[assistant] block:", b.type);
        }
      }
    } else if (msg.type === "user") {
      for (const b of msg.message?.content ?? []) {
        if (b.type === "tool_result") {
          console.log(
            "[user] tool_result is_error=", b.is_error,
            "| content=", JSON.stringify(b.content).slice(0, 1200)
          );
        }
      }
    } else if (msg.type === "result") {
      console.log("[user] tool_result（handler 已执行）");
    } else if (msg.type === "result") {
      console.log("[result] subtype=", msg.subtype);
    }
  }

  const after = await prisma.article.findUnique({
    where: { id: article.id },
    select: { digest: true },
  });
  const grant = await prisma.toolActionGrant.findFirst({
    where: { sessionId: realSessionId },
    orderBy: { createdAt: "desc" },
  });
  console.log("[probe] digest after:", JSON.stringify(after?.digest ?? null));
  console.log("[probe] grant status:", grant?.status, "| toolName:", grant?.toolName);

  const changed = !!after?.digest && after.digest !== originalDigest;
  // 注：本探测直接调 resolveApproval（不经 POST 端点），故 grant.status 仍为 pending；
  // 端点的 status 写入由 HTTP 层负责（与 code-source approve 同款，已 code review）。
  const mode = process.argv[2] === "reject" ? "reject" : "approve";
  if (mode === "approve") {
    if (approvalSeen && changed) {
      console.log("[probe] ✅ approve 路径通过：emit→同意→工具执行→DB 写入。");
    } else {
      console.error(
        "[probe] ❌ approve 路径未完成（approvalSeen=", !!approvalSeen,
        "digestChanged=", changed, ")"
      );
    }
  } else {
    // reject：工具应被拒，digest 不应写入。
    if (approvalSeen && !changed) {
      console.log("[probe] ✅ reject 路径通过：emit→拒绝→工具未执行→摘要未变。");
    } else {
      console.error(
        "[probe] ❌ reject 路径异常（approvalSeen=", !!approvalSeen,
        "digestChanged=", changed, "）"
      );
    }
  }

  // 还原摘要，保持 dev.db 干净。
  await prisma.article.update({
    where: { id: article.id },
    data: { digest: originalDigest },
  });
  console.log("[probe] 已还原原摘要。");
}

main().catch((err) => {
  console.error("[probe] 失败:", err);
  process.exit(1);
});
