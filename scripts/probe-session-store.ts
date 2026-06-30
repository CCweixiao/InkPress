// P5 探测：PrismaSessionStore 适配器本身（append/load/幂等/listSubkeys），不依赖 LLM。
//   DATABASE_URL=file:./dev.db pnpm tsx scripts/probe-session-store.ts
import { createPrismaSessionStore } from "../src/lib/ai/claude-session-store";
import { prisma } from "../src/lib/db";

async function main() {
  const store = createPrismaSessionStore();
  const sessionId = `probe-session-${Date.now()}`;
  const key = { projectKey: "probe-project", sessionId, subpath: "" };
  await prisma.claudeAgentSessionEntry.deleteMany({ where: { sdkSessionId: sessionId } });

  // append 3 entries：2 带 uuid、1 不带
  await store.append(key, [
    { type: "user", uuid: "u1", message: "hello" },
    { type: "assistant", uuid: "a1", message: "hi" },
    { type: "summary", message: "no-uuid-entry" },
  ]);
  let count = await prisma.claudeAgentSessionEntry.count({
    where: { sdkSessionId: sessionId },
  });
  console.log("[append] 3 条 → count=", count, count === 3 ? "✅" : "❌");

  // 幂等：重发相同 uuid（upsert，不增）+ 新的无 uuid（+1）
  await store.append(key, [
    { type: "user", uuid: "u1", message: "hello-updated" },
    { type: "summary", message: "no-uuid-2" },
  ]);
  count = await prisma.claudeAgentSessionEntry.count({
    where: { sdkSessionId: sessionId },
  });
  console.log(
    "[idempotent] 重发 → count=",
    count,
    count === 4 ? "✅ uuid 去重，无 uuid +1" : "❌"
  );

  // load：顺序返回 + uuid 内容已更新
  const loaded = await store.load(key);
  console.log("[load] 条数=", loaded?.length, loaded?.length === 4 ? "✅" : "❌");
  const u1 = loaded?.find((e) => (e as { uuid?: string }).uuid === "u1") as
    | { message?: string }
    | undefined;
  console.log(
    "[load] u1 已更新 =",
    u1?.message === "hello-updated" ? "✅" : "❌"
  );

  // load 不存在 → null
  const empty = await store.load({ ...key, sessionId: "nonexistent" });
  console.log("[load] 空会话 → null =", empty === null ? "✅" : "❌");

  // listSubkeys
  await store.append({ ...key, subpath: "sub1" }, [{ type: "x", uuid: "s1" }]);
  const subs = await store.listSubkeys({
    projectKey: key.projectKey,
    sessionId,
  });
  console.log(
    "[listSubkeys] =",
    JSON.stringify(subs),
    subs.includes("sub1") ? "✅" : "❌"
  );

  await prisma.claudeAgentSessionEntry.deleteMany({
    where: { sdkSessionId: sessionId },
  });
  console.log("[cleanup] done");
}

main().catch((e) => {
  console.error("[probe] 失败:", e);
  process.exit(1);
});
