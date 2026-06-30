import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import {
  INKPRESS_TOOLS,
  type InkPressToolContext,
  type InkPressToolDefinition,
} from "@/lib/ai/tools/registry";

/**
 * 把 InkPress 工具注册表包装成 Claude Agent SDK 的 in-process MCP server。
 *
 * 工具 handler 在 InkPress 服务端进程内执行（闭包持有本次 ctx），可直接用 prisma
 * 与上下文。handler 在执行前后通过 ctx.emit 直接向 UI 流写 UIMessage chunk
 * （tool-input-available / tool-output-available / tool-output-error，dynamic:true），
 * 现有前端按裸 toolName 渲染 ToolCallBlock / ProposalCard——无需依赖 SDK 是否把
 * tool_result 回流到消费流，也无需改动 stream adapter。
 *
 * 每次 query() 前用本次 ctx 重新构造，确保 target/sessionId/emit 是当前会话快照。
 */
export function createInkPressMcpServer(ctx: InkPressToolContext) {
  const tools = INKPRESS_TOOLS.map((def: InkPressToolDefinition) =>
    tool(
      def.name,
      typeof def.description === "function" ? def.description(ctx) : def.description,
      def.inputSchema,
      async (args) => {
        // 自生成的 toolCallId 仅供 UI 卡片聚合（input/output 用同一 id），
        // 与模型 tool_use 的内部 id 无关。
        const toolCallId = crypto.randomUUID();
        ctx.emit({
          type: "tool-input-available",
          toolCallId,
          toolName: def.name,
          input: args,
          dynamic: true,
        } as never);
        try {
          const result = await def.execute(ctx, args as Record<string, unknown>);
          ctx.emit({
            type: "tool-output-available",
            toolCallId,
            output: result,
            dynamic: true,
          } as never);
          const structured =
            result && typeof result === "object"
              ? (result as Record<string, unknown>)
              : undefined;
          return {
            content: [
              {
                type: "text" as const,
                text:
                  typeof result === "string" ? result : JSON.stringify(result),
              },
            ],
            structuredContent: structured,
            isError: false as const,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : "工具执行失败。";
          ctx.emit({
            type: "tool-output-error",
            toolCallId,
            errorText: message,
            dynamic: true,
          } as never);
          return {
            content: [{ type: "text" as const, text: message }],
            isError: true as const,
          };
        }
      },
      def.annotations ? { annotations: def.annotations } : undefined
    )
  );
  return createSdkMcpServer({ name: "inkpress", tools, alwaysLoad: true });
}
