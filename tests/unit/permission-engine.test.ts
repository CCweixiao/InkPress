import { describe, expect, it } from "vitest";
import {
  evaluateToolPermission,
  claudeAllowedTools,
  MCP_PREFIX,
} from "../../src/lib/ai/permission-engine";

describe("evaluateToolPermission", () => {
  it("registry 声明的决策", () => {
    expect(evaluateToolPermission("load_skill")).toBe("allow");
    expect(evaluateToolPermission("web_fetch")).toBe("ask");
    expect(evaluateToolPermission("set_article_digest")).toBe("ask");
  });
  it("未知工具默认 ask", () => {
    expect(evaluateToolPermission("__unknown__")).toBe("ask");
  });
  it("web_fetch 静态权限始终是 ask（自动放权在 canUseTool 动态处理）", () => {
    expect(evaluateToolPermission("web_fetch")).toBe("ask");
    expect(evaluateToolPermission("set_article_digest")).toBe("ask");
  });
});

describe("claudeAllowedTools", () => {
  it("默认含 allow 工具、不含 web_fetch", () => {
    const tools = claudeAllowedTools();
    expect(tools).toContain(MCP_PREFIX + "load_skill");
    expect(tools).not.toContain(MCP_PREFIX + "web_fetch");
  });
  it("webFetchAutoApprove=true 时仍不把 web_fetch 放入 allowedTools", () => {
    const tools = claudeAllowedTools();
    expect(tools).not.toContain(MCP_PREFIX + "web_fetch");
    expect(tools).toContain(MCP_PREFIX + "load_skill"); // 原 allow 仍在
  });
});
