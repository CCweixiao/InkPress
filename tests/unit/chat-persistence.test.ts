import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import {
  computeMerged,
  detectRelation,
  normalizeLoadedParts,
} from "../../src/lib/ai/chat-persistence";

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

/**
 * computeMerged 是 mergeAndPersistMessages 在事务内调用的纯合并函数，
 * 根据 detectRelation 的关系决定最终落盘的完整消息列表。四态各覆盖一例。
 */
const ids = (messages: UIMessage[]) => messages.map((m) => m.id);

describe("computeMerged", () => {
  it("new：DB 为空 → 直写前端列表", () => {
    const ui = [msg("a"), msg("b")];
    expect(ids(computeMerged("new", ui, []))).toEqual(["a", "b"]);
  });

  it("truncate：前端是 DB 连续前缀 → 前端权威，截断尾部", () => {
    const db = [msg("a"), msg("b"), msg("c")];
    const ui = [msg("a"), msg("b")];
    expect(ids(computeMerged("truncate", ui, db))).toEqual(["a", "b"]);
  });

  it("disjoint：无交集 → 保守直写前端列表（不丢前端数据）", () => {
    const db = [msg("a"), msg("b")];
    const ui = [msg("x"), msg("y")];
    expect(ids(computeMerged("disjoint", ui, db))).toEqual(["x", "y"]);
  });

  it("append（F-001）：remount 后只持末尾若干条 → 用 DB 前缀补全", () => {
    const db = [msg("a"), msg("x"), msg("y"), msg("b"), msg("c")];
    // 前端只持最后 2 条 [b, c]，分歧点 = c（前端最后一条在 DB 的消息）
    const ui = [msg("b"), msg("c")];
    expect(ids(computeMerged("append", ui, db))).toEqual([
      "a",
      "x",
      "y",
      "b",
      "c",
    ]);
  });

  it("append：DB 前缀 + 前端新增尾部 → 拼接补全", () => {
    const db = [msg("a"), msg("b")];
    // 前端 [b, new]：分歧点 = b，DB 取到 b 为止再接前端 b 之后的新消息
    const ui = [msg("b"), msg("new")];
    expect(ids(computeMerged("append", ui, db))).toEqual(["a", "b", "new"]);
  });

  it("append 兜底：无分歧点（理论不可达）→ 保守直写前端列表", () => {
    const db = [msg("a"), msg("b")];
    const ui = [msg("x"), msg("y")];
    // 关系误标 append 但实际无交集：不丢前端数据
    expect(ids(computeMerged("append", ui, db))).toEqual(["x", "y"]);
  });
});

/**
 * normalizeLoadedParts：DB 加载时修正工具 part 的未完成状态。
 *
 * 根因：客户端断连时 createUIMessageStream 的 cancel() 路径触发 onFinish，
 * 正在执行的工具 part 以 input-streaming / input-available 被持久化。
 * isPartStreaming 把这两个状态判为"运行中"，加载后永久 spinner。
 * 修复：历史消息中的工具 part 统一强制为 output-available。
 */
type AnyPart = UIMessage["parts"][number];

describe("normalizeLoadedParts", () => {
  it("input-streaming → output-available", () => {
    const parts = [
      { type: "dynamic-tool", state: "input-streaming", toolName: "web_search" },
    ] as unknown as UIMessage["parts"];
    const result = normalizeLoadedParts(parts);
    expect((result[0] as Record<string, unknown>).state).toBe("output-available");
  });

  it("input-available → output-available", () => {
    const parts = [
      { type: "dynamic-tool", state: "input-available", toolName: "explore_project" },
    ] as unknown as UIMessage["parts"];
    const result = normalizeLoadedParts(parts);
    expect((result[0] as Record<string, unknown>).state).toBe("output-available");
  });

  it("tool-* 前缀类型的 input-available 也被修正", () => {
    const parts = [
      { type: "tool-web_search", state: "input-available" },
    ] as unknown as UIMessage["parts"];
    const result = normalizeLoadedParts(parts);
    expect((result[0] as Record<string, unknown>).state).toBe("output-available");
  });

  it("output-available 不受影响", () => {
    const parts = [
      { type: "dynamic-tool", state: "output-available", toolName: "web_search" },
    ] as unknown as UIMessage["parts"];
    const result = normalizeLoadedParts(parts);
    expect((result[0] as Record<string, unknown>).state).toBe("output-available");
  });

  it("output-error 不受影响", () => {
    const parts = [
      { type: "dynamic-tool", state: "output-error", toolName: "web_search" },
    ] as unknown as UIMessage["parts"];
    const result = normalizeLoadedParts(parts);
    expect((result[0] as Record<string, unknown>).state).toBe("output-error");
  });

  it("非工具 part（text / data-*）不受影响", () => {
    const parts = [
      { type: "text", text: "hello" },
      { type: "data-agent-step", data: { status: "completed" } },
    ] as unknown as UIMessage["parts"];
    const result = normalizeLoadedParts(parts);
    expect(result).toEqual(parts);
  });

  it("混合列表：只修正未完成的工具 part，其余原样保留", () => {
    const parts = [
      { type: "text", text: "hi" },
      { type: "dynamic-tool", state: "input-available", toolName: "a" },
      { type: "dynamic-tool", state: "output-available", toolName: "b" },
      { type: "tool-c", state: "input-streaming" },
      { type: "data-agent-step", data: {} },
    ] as unknown as UIMessage["parts"];
    const result = normalizeLoadedParts(parts);
    expect((result[0] as Record<string, unknown>).type).toBe("text");
    expect((result[1] as Record<string, unknown>).state).toBe("output-available");
    expect((result[2] as Record<string, unknown>).state).toBe("output-available");
    expect((result[3] as Record<string, unknown>).state).toBe("output-available");
    expect((result[4] as Record<string, unknown>).type).toBe("data-agent-step");
  });

  it("无工具 part 时不创建新数组（引用不变优化）", () => {
    const parts = [{ type: "text", text: "hello" }] as unknown as UIMessage["parts"];
    expect(normalizeLoadedParts(parts)).toBe(parts);
  });
});
