import { describe, expect, it } from "vitest";
import {
  INKPRESS_TOOLS,
  loadInkPressToolDisplay,
} from "../../src/lib/ai/tools/registry";
import { uiMessageChunkSchema } from "ai";

const displayCtx = {
  target: { kind: "article" as const, id: "a1", title: "测试文章" },
};

describe("InkPress 工具 display 契约", () => {
  it("每个工具都声明了 category/version/display", () => {
    expect(INKPRESS_TOOLS.length).toBeGreaterThanOrEqual(15);
    for (const t of INKPRESS_TOOLS) {
      expect(t.category, `${t.name} 缺 category`).toBeTruthy();
      expect(t.version, `${t.name} version 非语义版本`).toMatch(/^\d+\.\d+\.\d+/);
      expect(typeof t.display, `${t.name} display 非函数`).toBe("function");
    }
  });

  it("每个工具 display 在 executing/completed/failed 三态都返回 title + activityKind", () => {
    for (const t of INKPRESS_TOOLS) {
      const results = [
        t.display({ phase: "executing", args: {}, ctx: displayCtx }),
        t.display({ phase: "completed", args: {}, output: {}, ctx: displayCtx }),
        t.display({ phase: "failed", args: {}, error: "boom", ctx: displayCtx }),
      ];
      for (const d of results) {
        expect(typeof d.title, `${t.name}.title`).toBe("string");
        expect(d.title.length, `${t.name}.title 为空`).toBeGreaterThan(0);
        expect(typeof d.activityKind, `${t.name}.activityKind`).toBe("string");
      }
    }
  });

  it("load_skill completed 摘要含「已加载」", () => {
    const d = loadInkPressToolDisplay("load_skill", {
      phase: "completed",
      args: { id: "wechat" },
      output: { name: "公众号写作" },
      ctx: displayCtx,
    });
    expect(d.title).toBe("补充加载 Skill");
    expect(d.summary).toContain("已加载");
  });

  it("project_read executing 带 metadata.path", () => {
    const d = loadInkPressToolDisplay("project_read", {
      phase: "executing",
      args: { path: "src/a.ts" },
      ctx: displayCtx,
    });
    expect(d.title).toBe("读取项目文件");
    expect(d.metadata?.path).toBe("src/a.ts");
  });

  it("git_log completed 摘要含提交数", () => {
    const d = loadInkPressToolDisplay("git_log", {
      phase: "completed",
      output: { commits: 7 },
      ctx: displayCtx,
    });
    expect(d.summary).toContain("7");
    expect(d.summary).toContain("提交");
  });

  it("web_search completed 摘要含结果数", () => {
    const d = loadInkPressToolDisplay("web_search", {
      phase: "completed",
      args: { query: "q" },
      output: { results: [{ url: "a" }, { url: "b" }] },
      ctx: displayCtx,
    });
    expect(d.title).toBe("搜索网络资料");
    expect(d.summary).toContain("2");
  });

  it("web_fetch executing 摘要含 url", () => {
    const d = loadInkPressToolDisplay("web_fetch", {
      phase: "executing",
      args: { url: "https://example.com" },
      ctx: displayCtx,
    });
    expect(d.title).toBe("读取网页正文");
    expect(d.summary).toContain("example.com");
  });

  it("loadInkPressToolDisplay 未知名兜底 general", () => {
    const d = loadInkPressToolDisplay("__unknown__", {
      phase: "executing",
      ctx: displayCtx,
    });
    expect(d.title).toBe("__unknown__");
    expect(d.activityKind).toBe("general");
  });
});

// 烟雾测试：带 toolMetadata.display + seq 的 tool chunk 必须能被 SDK schema 接受。
// 防 SDK 升级破坏 display/seq 通道（前端 strictObject 校验会让整条 SSE 流崩溃）。
// LazySchema().validate 基于 JSON Schema（宽松），故只验证「带 toolMetadata 不被拒」
// +「type 非法被拒（证明 validate 非空）」；toolMetadata 字段的合法性另由 TS 类型
// （DynamicToolUIPart.toolMetadata）在 typecheck 期保证。
describe("uiMessageChunkSchema 烟雾测试（display/seq 通道）", () => {
  // LazySchema().validate 基于 JSON Schema（宽松），TS 类型为可选方法 + sync 返回（与运行时 async 不符），
  // 故 cast 成稳定形态。toolMetadata 字段的合法性另由 TS 类型（DynamicToolUIPart.toolMetadata）在 typecheck 期保证。
  const schema = uiMessageChunkSchema() as unknown as {
    validate: (v: unknown) => Promise<{ success: boolean }>;
  };

  it("带 toolMetadata.display/seq 的 tool-input-available 通过校验", async () => {
    const r = await schema.validate({
      type: "tool-input-available",
      toolCallId: "c1",
      toolName: "project_read",
      input: { path: "a.ts" },
      dynamic: true,
      toolMetadata: {
        display: { title: "读取项目文件", activityKind: "read" },
        seq: 1,
        turnId: "t",
        source: "tool",
      },
    });
    expect(r.success).toBe(true);
  });

  it("带 toolMetadata.seq 的 tool-output-available 通过校验", async () => {
    const r = await schema.validate({
      type: "tool-output-available",
      toolCallId: "c1",
      output: { ok: true },
      dynamic: true,
      toolMetadata: { seq: 2, turnId: "t", source: "tool" },
    });
    expect(r.success).toBe(true);
  });

  it("type 非法的 chunk 被拒绝（证明 validate 在校验）", async () => {
    const r = await schema.validate({ type: "__not_a_real_chunk_type__" });
    expect(r.success).toBe(false);
  });
});
