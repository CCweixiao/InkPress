// 探测：用真实 InkPress MCP server 跑一次 load_skill，确认
// (a) inkpress 工具已注册进 SDK init、(b) 模型发出 tool_use、(c) in-process handler 被执行、(d) emit 写出工具 chunk。
//
//   pnpm tsx scripts/probe-mcp.ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createInkPressMcpServer } from "../src/lib/ai/inkpress-mcp-server";
import { listSkills } from "../src/lib/ai/skills";
import { chooseLlmConfig } from "../src/lib/ai/llm-config";
import { buildInkPressSystemPrompt } from "../src/lib/ai/system-prompt";

async function main() {
  const cfg = await chooseLlmConfig();
  if (!cfg || !cfg.apiKey) {
    console.error("[probe] 缺 AI 模型配置");
    process.exit(1);
  }
  const skillCatalog = await listSkills();
  const firstSkill =
    skillCatalog.find((s) => s.id === "wechat-writing")?.id ??
    skillCatalog[0]?.id ??
    "wechat-writing";
  console.log("[probe] model=", cfg.model.id, "| firstSkill=", firstSkill);

  const ctx = {
    target: { kind: "article" as const, id: "probe", title: "探测文章", markdown: "" },
    sessionId: "probe",
    skillCatalog,
    emit: (p: never) =>
      console.log("[emit]", JSON.stringify(p as unknown).slice(0, 300)),
  };
  const mcp = createInkPressMcpServer(ctx);

  const ac = new AbortController();
  let sawToolUse = false;
  let sawToolResult = false;
  for await (const msg of query({
    prompt: `请调用 mcp__inkpress__load_skill 工具，加载 ${firstSkill} 这个 Skill 的完整手册。`,
    options: {
      env: {
        ...process.env,
        ANTHROPIC_BASE_URL: cfg.baseUrl,
        ANTHROPIC_AUTH_TOKEN: cfg.apiKey,
        ANTHROPIC_API_KEY: undefined,
      },
      model: cfg.model.id,
      systemPrompt: buildInkPressSystemPrompt({ target: ctx.target, skillCatalog }),
      mcpServers: { inkpress: mcp },
      allowedTools: [
        "mcp__inkpress__load_skill",
        "mcp__inkpress__read_skill_resource",
        "mcp__inkpress__article_assets",
        "mcp__inkpress__propose_article_revision",
        "mcp__inkpress__propose_technical_document_revision",
      ],
      tools: [],
      settingSources: [],
      persistSession: false,
      includePartialMessages: true,
      abortController: ac,
      maxTurns: 3,
    },
  }) as AsyncIterable<{
    type: string;
    subtype?: string;
    tools?: string[];
    message?: { content?: Array<{ type: string }> };
  }>) {
    if (msg.type === "system" && msg.subtype === "init") {
      const ink = (msg.tools ?? []).filter((t) => t.includes("inkpress"));
      console.log(
        "[init] inkpress tools:",
        ink.length ? ink.join(", ") : "(NONE — 注册失败)"
      );
    } else if (msg.type === "assistant") {
      const blocks = (msg.message?.content ?? []).map((b) => b.type);
      if (blocks.includes("tool_use")) sawToolUse = true;
      console.log("[assistant] blocks:", blocks.join(","));
    } else if (msg.type === "user") {
      sawToolResult = true;
      console.log("[user] tool_result（handler 已执行）");
    } else if (msg.type === "result") {
      console.log("[result] subtype=", msg.subtype);
    }
  }
  console.log(`[probe] sawToolUse=${sawToolUse} sawToolResult=${sawToolResult}`);
}

main().catch((err) => {
  console.error("[probe] 失败:", err);
  process.exit(1);
});

