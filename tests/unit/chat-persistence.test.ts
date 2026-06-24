import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { detectRelation } from "../../src/lib/ai/chat-persistence";

/**
 * detectRelation 是 mergeAndPersistMessages 的纯函数判定核心，决定前端消息列表
 * 如何与 DB 历史合并。重点覆盖 F-001 回归根因：remount 后前端只持末尾若干条时，
 * 不能因「末条 id 命中 DB」就误判为 truncate 而删掉更早的历史。
 */

const msg = (id: string, role: UIMessage["role"] = "user"): UIMessage => ({
  id,
  role,
  parts: [{ type: "text", text: id }],
});

const noId = (role: UIMessage["role"] = "user"): UIMessage => ({
  role,
  parts: [{ type: "text", text: "no-id" }],
}) as UIMessage;

describe("detectRelation", () => {
  it("DB 为空 → new（含前端也空的边界）", () => {
    expect(detectRelation([msg("a")], [])).toBe("new");
    expect(detectRelation([], [])).toBe("new");
  });

  it("前端是 DB 连续前缀（短于 DB）→ truncate", () => {
    const db = [msg("a"), msg("b"), msg("c")];
    expect(detectRelation([msg("a"), msg("b")], db)).toBe("truncate");
  });

  it("前端与 DB 完全一致 → truncate（幂等重写）", () => {
    const db = [msg("a"), msg("b")];
    expect(detectRelation([msg("a"), msg("b")], db)).toBe("truncate");
  });

  it("regenerate：前端是 DB 去掉尾部 assistant 后的前缀 → truncate", () => {
    const db = [msg("a", "user"), msg("b", "assistant")];
    expect(detectRelation([msg("a", "user")], db)).toBe("truncate");
  });

  it("F-001 核心：remount 后只持末尾若干条，末条在 DB 但非前缀 → append（不误判 truncate）", () => {
    // DB 5 条，前端 remount 后只持最后 2 条（b、c），末条 c 在 DB
    const db = [msg("a"), msg("x"), msg("y"), msg("b"), msg("c")];
    expect(detectRelation([msg("b"), msg("c")], db)).toBe("append");
  });

  it("前端末条恰在 DB，但中间断裂（非连续前缀）→ append", () => {
    const db = [msg("a"), msg("b"), msg("c")];
    // 前端 [a, c]：末条 c 在 DB，但跳过了 b，不是连续前缀
    expect(detectRelation([msg("a"), msg("c")], db)).toBe("append");
  });

  it("append：前端末条不在 DB 但存在交集 → append", () => {
    const db = [msg("a"), msg("b")];
    expect(detectRelation([msg("b"), msg("new")], db)).toBe("append");
  });

  it("前端比 DB 长且以 DB 为前缀 → append（有新消息待追加）", () => {
    const db = [msg("a")];
    expect(detectRelation([msg("a"), msg("b")], db)).toBe("append");
  });

  it("disjoint：前端与 DB 无任何 id 交集 → disjoint", () => {
    const db = [msg("a"), msg("b")];
    expect(detectRelation([msg("x"), msg("y")], db)).toBe("disjoint");
  });

  it("含无 id 消息时不参与匹配，不会误判为 truncate", () => {
    const db = [msg("a"), msg("b")];
    // 前端 [a, noId]：a 匹配 db[0]，但第二条无 id → 非连续前缀 → append
    expect(detectRelation([msg("a"), noId()], db)).toBe("append");
  });

  it("全部无 id 的前端 vs 有 DB → disjoint（无任何可靠交集）", () => {
    const db = [msg("a"), msg("b")];
    expect(detectRelation([noId(), noId("assistant")], db)).toBe("disjoint");
  });
});
