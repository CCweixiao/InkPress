import type { UIStreamWriterLike } from "@/lib/ai/agent-sdk-stream-adapter";
import type { AgentEventSource } from "@/lib/ai/agent-runtime-events";

/**
 * seq 注入包装器（P0 协议冻结）。
 *
 * 把 createUIMessageStream 提供的 writer 包一层，为 **data part 和 tool part** 注入单调递增的
 * `seq` + `turnId` + `source`。text/reasoning 等流式 part 靠 id 聚合，不注入也不计数。
 *
 * 注入位置（命门，见 docs/agent-runtime-pdc.md / 计划文件「命门结论」）：
 * - data-* → `part.data.{seq,turnId,source}`（data part 的 data 字段是 z.unknown()，开放）。
 * - tool-input-available/output-available/output-error/input-error → `part.toolMetadata.{seq,turnId,source}`
 *   （tool part 的合法扩展点；spread merge，**不得覆盖 MCP 已写的 display**）。
 * - 绝不加顶层字段——Vercel AI SDK 客户端用 strictObject 校验，顶层未知字段会让整条 SSE 流崩溃。
 *
 * 一个 turn 一个实例（route execute 内创建一次），所有下游（runtime/adapter/MCP/canUseTool/工具 execute）
 * 都汇流到它，保证 seq 单调无断号。
 */
export function createAgentEventWriter(
  writer: UIStreamWriterLike,
  opts: { turnId: string; source: AgentEventSource }
): UIStreamWriterLike {
  let seq = 0;
  const stamp = (extra: Record<string, unknown>) => ({
    ...extra,
    seq: (seq += 1),
    turnId: opts.turnId,
    source: opts.source,
  });

  return {
    write: (part: never) => {
      const p = part as Record<string, unknown>;
      const type = typeof p.type === "string" ? p.type : "";

      if (type.startsWith("data-")) {
        const data =
          p.data && typeof p.data === "object"
            ? (p.data as Record<string, unknown>)
            : {};
        p.data = stamp(data);
      } else if (
        type === "tool-input-available" ||
        type === "tool-output-available" ||
        type === "tool-output-error" ||
        type === "tool-input-error"
      ) {
        const tm =
          p.toolMetadata && typeof p.toolMetadata === "object"
            ? (p.toolMetadata as Record<string, unknown>)
            : {};
        // spread merge：保留 MCP 写入的 display，仅追加 seq/turnId/source。
        p.toolMetadata = stamp(tm);
      }

      writer.write(part);
    },
  };
}
