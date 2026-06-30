// 探测 /api/ai/agent-approvals 端点逻辑（token 校验 + status 写入）。
// 需先启动 dev server：DATABASE_URL=file:./dev.db pnpm dev
//   DATABASE_URL=file:./dev.db pnpm tsx scripts/probe-approval-endpoint.ts
import crypto from "node:crypto";
import { prisma } from "../src/lib/db";

function hashToken(t: string) {
  return crypto.createHash("sha256").update(t).digest("hex");
}

async function main() {
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

  const token = "smoketest-token-0123456789abcdef";
  const grant = await prisma.toolActionGrant.create({
    data: {
      sessionId: session.id,
      toolName: "set_article_digest",
      inputHash: hashToken("dummy-input"),
      approvalTokenHash: hashToken(token),
      status: "pending",
    },
  });
  console.log("[probe] created grant:", grant.id, "(status=pending)");

  // 1) 正确 token + approve → 期望 {ok, status:approved, woken:false}
  const okRes = await fetch(`http://localhost:3000/api/ai/agent-approvals/${grant.id}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ approvalToken: token, action: "approve" }),
  });
  const okBody = await okRes.json().catch(() => ({}));
  console.log("[probe] POST approve →", okRes.status, JSON.stringify(okBody));

  // 2) 重复决议（已 approved）→ 期望 409
  const dupRes = await fetch(`http://localhost:3000/api/ai/agent-approvals/${grant.id}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ approvalToken: token, action: "approve" }),
  });
  const dupBody = await dupRes.json().catch(() => ({}));
  console.log("[probe] POST dup →", dupRes.status, JSON.stringify(dupBody));

  // 3) GET status → 期望 approved
  const stRes = await fetch(`http://localhost:3000/api/ai/agent-approvals/${grant.id}/status`);
  const stBody = await stRes.json().catch(() => ({}));
  console.log("[probe] GET status →", stRes.status, JSON.stringify(stBody));

  // 4) 错误 token（新建一个 pending grant）→ 期望 409 令牌无效
  const grant2 = await prisma.toolActionGrant.create({
    data: {
      sessionId: session.id,
      toolName: "set_article_digest",
      inputHash: hashToken("dummy2"),
      approvalTokenHash: hashToken(token),
      status: "pending",
    },
  });
  const badRes = await fetch(`http://localhost:3000/api/ai/agent-approvals/${grant2.id}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ approvalToken: "wrong-token-1234567890", action: "approve" }),
  });
  const badBody = await badRes.json().catch(() => ({}));
  console.log("[probe] POST wrong token →", badRes.status, JSON.stringify(badBody));

  // 清理探测行。
  await prisma.toolActionGrant.deleteMany({
    where: { id: { in: [grant.id, grant2.id] } },
  });
  console.log("[probe] 已清理探测 grant 行。");

  const pass =
    okRes.status === 200 &&
    okBody.status === "approved" &&
    okBody.woken === false &&
    dupRes.status === 409 &&
    stBody.status === "approved" &&
    badRes.status === 409;
  console.log(pass ? "[probe] ✅ 端点逻辑全通。" : "[probe] ❌ 端点逻辑有异常（见上）。");
}

main().catch((e) => {
  console.error("[probe] 失败:", e);
  process.exit(1);
});
