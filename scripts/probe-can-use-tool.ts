// 探测 canUseTool：把 set_article_digest 移出 allowedTools（=ask），确认 SDK 在执行前回调
// canUseTool，并校准 toolName 形态（完整名 mcp__inkpress__* vs 裸名）+ options.title/displayName/description。
//
//   DATABASE_URL=file:./dev.db pnpm tsx scripts/probe-can-use-tool.ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createInkPressMcpServer } from "../src/lib/ai/inkpress-mcp-server";
import { listSkills } from "../src/lib/ai/skills";
import { getClaudeAgentConfig } from "../src/lib/ai/claude-agent-config";
import { buildInkPressSystemPrompt } from "../src/lib/ai/system-prompt";

async function main() {
  const cfg = await getClaudeAgentConfig();
  if (!cfg.apiKey) {
    console.error("[probe] 缺 API Key");
    process.exit(1);
  }
  const skillCatalog = await listSkills();
  const ctx = {
    target: {
      kind: "article" as const,
      id: "probe",
      title: "探测文章",
      markdown:
        "Claude Agent SDK 让开发者把 Claude 的编程与推理能力嵌入程序，支持工具循环、流式输出与权限管理。",
    },
    sessionId: "probe",
    skillCatalog,
    emit: (p: never) => console.log("[emit]", JSON.stringify(p as unknown).slice(0, 200)),
  };
  const mcp = createInkPressMcpServer(ctx);

  let canUseToolFired = false;
  const ac = new AbortController();
  for await (const msg of query({
    prompt: "请为这篇文章生成一句话摘要并写入摘要字段。",
    options: {
      env: {
        ...process.env,
        ANTHROPIC_BASE_URL: cfg.baseUrl,
        ANTHROPIC_AUTH_TOKEN: cfg.apiKey,
        ANTHROPIC_API_KEY: undefined,
      },
      model: cfg.model,
      systemPrompt: buildInkPressSystemPrompt({ target: ctx.target, skillCatalog }),
      mcpServers: { inkpress: mcp },
      // 关键：set_article_digest 不在 allowedTools → 应回调 canUseTool
      allowedTools: [
        "mcp__inkpress__load_skill",
        "mcp__inkpress__read_skill_resource",
        "mcp__inkpress__article_assets",
      ],
      canUseTool: async (toolName, input, options) => {
        canUseToolFired = true;
        console.log("[canUseTool] ✅ FIRED");
        console.log("  toolName    =", toolName);
        console.log("  title       =", options.title);
        console.log("  displayName =", options.displayName);
        console.log("  description =", options.description);
        console.log("  toolUseID   =", options.toolUseID);
        console.log("  input       =", JSON.stringify(input).slice(0, 200));
        // 探测时直接 deny，避免真实写库（id=probe 不存在）
        return { behavior: "deny", message: "probe: 仅探测 canUseTool 是否触发" };
      },
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
    message?: { content?: Array<{ type: string }> };
  }>) {
    if (msg.type === "assistant") {
      const blocks = (msg.message?.content ?? []).map((b) => b.type);
      console.log("[assistant] blocks:", blocks.join(","));
    } else if (msg.type === "result") {
      console.log("[result] subtype=", msg.subtype);
    }
  }
  console.log(`\n[probe] canUseToolFired=${canUseToolFired}`);
  if (canUseToolFired) {
    console.log("[probe] ✅ canUseTool 已触发——blocking-Promise 桥可行。");
  } else {
    console.error("[probe] ❌ canUseTool 未触发——SDK 对未在 allowedTools 的工具可能直接 deny。");
  }
}

main().catch((err) => {
  console.error("[probe] 失败:", err);
  process.exit(1);
});
