import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { runMigrations } from "@/lib/migration";
import { migrationsDir } from "@/lib/paths";
import { createPrismaSessionStore } from "@/lib/ai/claude-session-store";
import type { SessionKey, SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";

/**
 * SessionStore conformance（claude-agent-session PDC §10.4）。
 *
 * 用临时 SQLite 文件跑全量迁移 → 注入独立 PrismaClient（不污染全局单例 dev.db），
 * 验证 append/load/listSubkeys 的幂等、保序、去重契约。
 */

const tmpDb = path.join(
  os.tmpdir(),
  `inkpress-session-conf-${process.pid}-${Date.now()}.db`
);
let prisma: PrismaClient;

const key = (overrides: Partial<SessionKey> = {}): SessionKey => ({
  projectKey: "proj-test",
  sessionId: "sdk-session-1",
  subpath: "",
  ...overrides,
});

function entry(
  type: string,
  extra: Partial<SessionStoreEntry> = {}
): SessionStoreEntry {
  return { type, timestamp: "2026-07-01T00:00:00.000Z", ...extra } as SessionStoreEntry;
}

beforeAll(async () => {
  try {
    fs.unlinkSync(tmpDb);
  } catch {
    /* 文件可能不存在 */
  }
  await runMigrations(tmpDb, migrationsDir());
  const adapter = new PrismaBetterSqlite3({ url: tmpDb });
  prisma = new PrismaClient({ adapter });
});

afterAll(async () => {
  await prisma?.$disconnect();
  try {
    fs.unlinkSync(tmpDb);
  } catch {
    /* 清理容忍 */
  }
});

describe("SessionStore append/load round-trip + 保序", () => {
  it("append 后 load 回同批 entries 且顺序不变", async () => {
    const k = key({ sessionId: "sdk-roundtrip" });
    const store = createPrismaSessionStore(prisma);
    const entries = [
      entry("user", { uuid: "u1", message: "first" }),
      entry("assistant", { uuid: "u2", message: "second" }),
      entry("summary", { uuid: "u3", text: "third" }),
    ];
    await store.append(k, entries);
    const loaded = await store.load(k);
    expect(loaded).not.toBeNull();
    expect(loaded!.map((e) => e.type)).toEqual([
      "user",
      "assistant",
      "summary",
    ]);
    // 内容 round-trip（key 顺序可能变，但字段值等价）。
    expect(loaded![0]).toMatchObject({ type: "user", uuid: "u1", message: "first" });
  });

  it("appendSeq 在同 session/subpath 下单调递增", async () => {
    const k = key({ sessionId: "sdk-seq" });
    const store = createPrismaSessionStore(prisma);
    await store.append(k, [
      entry("user", { uuid: "a1" }),
      entry("assistant", { uuid: "a2" }),
    ]);
    await store.append(k, [entry("summary", { uuid: "a3" })]);
    const rows = await prisma.claudeAgentSessionEntry.findMany({
      where: { sdkSessionId: k.sessionId, subpath: k.subpath ?? "" },
      orderBy: { appendSeq: "asc" },
      select: { uuid: true, appendSeq: true },
    });
    const seqs = rows
      .filter((r) => r.uuid !== null)
      .map((r) => r.appendSeq);
    expect(seqs).toEqual([1, 2, 3]);
  });
});

describe("SessionStore uuid 幂等（重放不重复、不破坏顺序）", () => {
  it("同批 entries 重放两次：行数不翻倍，load 结果稳定", async () => {
    const k = key({ sessionId: "sdk-dedupe" });
    const store = createPrismaSessionStore(prisma);
    const batch = [
      entry("user", { uuid: "d1" }),
      entry("assistant", { uuid: "d2" }),
    ];
    await store.append(k, batch);
    await store.append(k, batch); // SDK 重试 / 重放
    const count = await prisma.claudeAgentSessionEntry.count({
      where: { sdkSessionId: k.sessionId, subpath: k.subpath ?? "" },
    });
    expect(count).toBe(2);
    const loaded = await store.load(k);
    expect(loaded!.map((e) => e.uuid)).toEqual(["d1", "d2"]);
  });

  it("uuid 重放命中 update 分支：appendSeq 不被重排（新条目仍落在已存在最大值之后）", async () => {
    const k = key({ sessionId: "sdk-replay-order" });
    const store = createPrismaSessionStore(prisma);
    await store.append(k, [
      entry("user", { uuid: "r1" }),
      entry("assistant", { uuid: "r2" }),
    ]);
    // 第二批：r2 重放 + r3 新增。r2 不应抢占 r3 的序。
    await store.append(k, [
      entry("assistant", { uuid: "r2" }),
      entry("summary", { uuid: "r3" }),
    ]);
    const rows = await prisma.claudeAgentSessionEntry.findMany({
      where: { sdkSessionId: k.sessionId, subpath: k.subpath ?? "" },
      orderBy: { appendSeq: "asc" },
      select: { uuid: true, appendSeq: true },
    });
    const byUuid = Object.fromEntries(
      rows.filter((r) => r.uuid).map((r) => [r.uuid, r.appendSeq])
    );
    expect(byUuid.r1).toBe(1);
    expect(byUuid.r2).toBe(2); // 保持原序，未被第二批重排
    expect(byUuid.r3).toBe(3); // 新条目落在最大值之后
  });

  it("同批内重复 uuid 不重复消耗 appendSeq", async () => {
    const k = key({ sessionId: "sdk-same-batch-dupe" });
    const store = createPrismaSessionStore(prisma);
    await store.append(k, [
      entry("user", { uuid: "b1", message: "first" }),
      entry("user", { uuid: "b1", message: "first replay" }),
      entry("assistant", { uuid: "b2" }),
    ]);
    const rows = await prisma.claudeAgentSessionEntry.findMany({
      where: { sdkSessionId: k.sessionId, subpath: k.subpath ?? "" },
      orderBy: { appendSeq: "asc" },
      select: { uuid: true, appendSeq: true, entryJson: true },
    });
    expect(rows.map((r) => [r.uuid, r.appendSeq])).toEqual([
      ["b1", 1],
      ["b2", 2],
    ]);
    expect(JSON.parse(rows[0]!.entryJson)).toMatchObject({
      message: "first replay",
    });
  });
});

describe("SessionStore 无 uuid 条目不去重", () => {
  it("标题/标签等无 uuid 条目：append 两次产生两行", async () => {
    const k = key({ sessionId: "sdk-nouuid" });
    const store = createPrismaSessionStore(prisma);
    await store.append(k, [entry("title", { title: "A" })]);
    await store.append(k, [entry("title", { title: "B" })]);
    const count = await prisma.claudeAgentSessionEntry.count({
      where: { sdkSessionId: k.sessionId, subpath: k.subpath ?? "" },
    });
    expect(count).toBe(2);
  });
});

describe("SessionStore load 空语义 + listSubkeys", () => {
  it("从未写过的 key load 返回 null", async () => {
    const store = createPrismaSessionStore(prisma);
    const loaded = await store.load(key({ sessionId: "never-written" }));
    expect(loaded).toBeNull();
  });

  it("listSubkeys 返回子 agent subpath（去重）", async () => {
    const k = key({ sessionId: "sdk-subkeys" });
    const store = createPrismaSessionStore(prisma);
    await store.append({ ...k, subpath: "subagents/agent-1" }, [
      entry("user", { uuid: "s1" }),
    ]);
    await store.append({ ...k, subpath: "subagents/agent-2" }, [
      entry("user", { uuid: "s2" }),
    ]);
    // 主 transcript 也写一条（subpath=""）确保不被列出。
    await store.append({ ...k, subpath: "" }, [entry("user", { uuid: "s3" })]);
    // listSubkeys 在 SessionStore 接口里是可选的；本实现一定提供，断言其存在再调用。
    expect(store.listSubkeys).toBeDefined();
    const subkeys = await store.listSubkeys!({
      projectKey: k.projectKey,
      sessionId: k.sessionId,
    });
    expect(subkeys.sort()).toEqual(["subagents/agent-1", "subagents/agent-2"]);
  });
});
