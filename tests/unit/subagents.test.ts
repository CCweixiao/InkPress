import { describe, expect, it } from "vitest";
import { INKPRESS_SUBAGENTS, buildSubagents } from "../../src/lib/ai/subagents";
import { MCP_PREFIX } from "../../src/lib/ai/permission-engine";
import { INKPRESS_TOOLS } from "../../src/lib/ai/tools/registry";

const ALLOW_TOOLS = new Set(
  INKPRESS_TOOLS.filter((t) => t.permission === "allow").map((t) => t.name)
);
const ASK_TOOLS = new Set(
  INKPRESS_TOOLS.filter((t) => t.permission === "ask").map((t) => t.name)
);

describe("subagents", () => {
  it("声明 research / review / fact_check 三个子 agent", () => {
    const ids = Object.keys(INKPRESS_SUBAGENTS);
    expect(ids).toEqual(expect.arrayContaining(["research", "review", "fact_check"]));
    expect(ids.length).toBe(3);
  });

  it("每个子 agent 字段完整", () => {
    for (const [id, a] of Object.entries(INKPRESS_SUBAGENTS)) {
      expect(a.description.length, `${id} description`).toBeGreaterThan(10);
      expect(a.prompt.length, `${id} prompt`).toBeGreaterThan(30);
      expect(a.tools instanceof Array ? a.tools.length : 0, `${id} tools`).toBeGreaterThan(0);
    }
  });

  it("tools 只含 allow 工具（不含 ask 的 web_fetch/set_article_digest/propose_*）", () => {
    for (const [id, a] of Object.entries(INKPRESS_SUBAGENTS)) {
      const tools = (a.tools ?? []) as string[];
      for (const fullName of tools) {
        const bare = fullName.startsWith(MCP_PREFIX)
          ? fullName.slice(MCP_PREFIX.length)
          : fullName;
        expect(ALLOW_TOOLS.has(bare), `${id} 含非 allow 工具 ${bare}`).toBe(true);
        expect(ASK_TOOLS.has(bare), `${id} 不应含 ask 工具 ${bare}`).toBe(false);
      }
    }
  });

  it("research 含 web_search + project_read；review 含 load_skill；fact_check 含 web_search", () => {
    const has = (id: string, bare: string) =>
      ((INKPRESS_SUBAGENTS[id].tools ?? []) as string[]).some(
        (f) => f === MCP_PREFIX + bare
      );
    expect(has("research", "web_search")).toBe(true);
    expect(has("research", "project_read")).toBe(true);
    expect(has("review", "load_skill")).toBe(true);
    expect(has("fact_check", "web_search")).toBe(true);
  });

  it("buildSubagents 返回与 INKPRESS_SUBAGENTS 一致", () => {
    expect(buildSubagents()).toBe(INKPRESS_SUBAGENTS);
  });

  it("子 agent 不内嵌 Agent 工具，避免递归委派", () => {
    for (const [id, a] of Object.entries(INKPRESS_SUBAGENTS)) {
      expect((a.tools ?? []) as string[], `${id} tools`).not.toContain("Agent");
    }
  });
});
