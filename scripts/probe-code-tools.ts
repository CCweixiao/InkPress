// P4 探测：给 InkPress 仓库本身建一个 approved local 代码源，跑 buildClaudeAgentOptions
// （含 7 个代码工具 + 代码探索系统提示），让 Claude 调 project_overview/project_read/git_log，
// 校验证据 chip（data-project-snapshot/data-source-evidence/data-git-range/data-commit-evidence）发出。
//
//   DATABASE_URL=file:./dev.db pnpm tsx scripts/probe-code-tools.ts
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { prisma } from "../src/lib/db";
import { buildClaudeAgentOptions } from "../src/lib/ai/claude-agent-options";
import type { CodeSourceReference } from "../src/lib/ai/code-source";

async function main() {
  const root = process.cwd();
  const article = await prisma.article.findFirst({
    where: { trashed: false },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  if (!article) {
    console.error("[probe] 无文章");
    process.exit(1);
  }
  const session = await prisma.agentChatSession.upsert({
    where: { articleId: article.id },
    create: { articleId: article.id, targetKind: "article", runtime: "claude-agent" },
    update: {},
    select: { id: true },
  });

  // 建一个 approved local 代码源（InkPress 仓库本身）。
  const grant = await prisma.codeSourceGrant.create({
    data: {
      sessionId: session.id,
      kind: "local",
      sourceKey: `probe-local-${Date.now()}`,
      displayName: "InkPress",
      locator: root,
      root,
      scope: "session",
      status: "approved",
    },
  });
  const codeSource: CodeSourceReference = {
    id: grant.id,
    kind: "local",
    sourceKey: grant.sourceKey,
    displayName: grant.displayName,
    locator: grant.locator,
    root: grant.root!,
    scope: "session",
    status: "approved",
  };
  console.log("[probe] codeSource:", codeSource.displayName, "@", codeSource.root);

  const seen = new Set<string>();
  const options = await buildClaudeAgentOptions({
    target: {
      kind: "article",
      id: article.id,
      title: "探测技术文档",
      markdown: "",
    },
    sessionId: session.id,
    codeSource,
    emit: (part) => {
      const p = part as unknown as { type: string; data?: Record<string, unknown> };
      if (
        [
          "data-project-snapshot",
          "data-source-evidence",
          "data-git-range",
          "data-commit-evidence",
          "data-change-evidence-summary",
        ].includes(p.type)
      ) {
        if (!seen.has(p.type)) {
          seen.add(p.type);
          console.log("[emit]", p.type, JSON.stringify(p.data).slice(0, 160));
        }
      }
    },
  });

  const ac = new AbortController();
  for await (const msg of query({
    prompt:
      "请用代码工具分析当前授权项目：先 project_overview 看结构，再 project_read 读 package.json，再 git_log 看最近 3 条提交。简短汇报。",
    options: { ...options, abortController: ac, maxTurns: 8 },
  }) as AsyncIterable<{
    type: string;
    subtype?: string;
    message?: {
      content?: Array<{
        type: string;
        name?: string;
        is_error?: boolean;
        content?: unknown;
      }>;
    };
  }>) {
    if (msg.type === "assistant") {
      for (const b of msg.message?.content ?? []) {
        if (b.type === "tool_use") console.log("[assistant] tool_use:", b.name);
      }
    } else if (msg.type === "user") {
      for (const b of msg.message?.content ?? []) {
        if (b.type === "tool_result") {
          console.log(
            "[user] tool_result is_error=", b.is_error,
            "|", JSON.stringify(b.content).slice(0, 120)
          );
        }
      }
    } else if (msg.type === "result") {
      console.log("[result] subtype=", msg.subtype);
    }
  }

  await prisma.codeSourceGrant.delete({ where: { id: grant.id } }).catch(() => undefined);
  console.log("[probe] 已清理探测 codeSourceGrant。");

  const wanted = ["data-project-snapshot", "data-source-evidence", "data-git-range", "data-commit-evidence"];
  const got = wanted.filter((t) => seen.has(t));
  console.log("\n[probe] 证据 chip 发出:", got.join(", ") || "(无)");
  console.log(
    got.length >= 3
      ? "[probe] ✅ P4 代码工具可用 + 证据 chip 发出。"
      : "[probe] ❌ 证据 chip 不足（期望至少 snapshot/source/git-range/commit 中 3 种）。"
  );
}

main().catch((err) => {
  console.error("[probe] 失败:", err);
  process.exit(1);
});
