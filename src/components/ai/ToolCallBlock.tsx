"use client";

import { useState } from "react";
import {
  Check,
  ChevronRight,
  FileSearch,
  Globe2,
  Loader2,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

const TOOL_LABELS: Record<string, string> = {
  set_task_plan: "制定执行计划",
  load_skill: "补充加载 Skill",
  read_skill_resource: "读取 Skill 资源",
  web_search: "搜索网络资料",
  web_extract: "读取网页正文",
  project_search: "搜索本地代码项目",
  project_read: "读取项目文件",
  explore_project: "只读探索代码项目",
  analyze_code_changes: "分析 Git 提交与代码差异",
  github_pull_request: "读取 GitHub Pull Request",
  article_assets: "筛选文章素材",
  propose_article_revision: "生成文章修改提案",
  propose_technical_document_revision: "生成技术文档提案",
};

function ToolIcon({ name }: { name: string }) {
  if (name.startsWith("web_")) return <Globe2 className="h-3.5 w-3.5" />;
  if (name.startsWith("project_")) return <FileSearch className="h-3.5 w-3.5" />;
  if (name === "load_skill") return <Sparkles className="h-3.5 w-3.5" />;
  return <Wrench className="h-3.5 w-3.5" />;
}

function summarizeTool(toolName: string, output: unknown, errorText?: unknown) {
  if (typeof errorText === "string") return errorText;
  if (!output || typeof output !== "object") return "执行完成";
  const value = output as Record<string, unknown>;
  if (toolName === "set_task_plan" && Array.isArray(value.steps)) {
    return `${value.intent ?? "任务"} · ${value.steps.length} 个步骤`;
  }
  if (toolName === "load_skill") return `已加载 ${value.name ?? value.id ?? "Skill"}`;
  if (toolName === "web_search") {
    return `获得 ${Array.isArray(value.results) ? value.results.length : 0} 条搜索结果`;
  }
  if (toolName === "project_search") {
    return `找到 ${Array.isArray(value.matches) ? value.matches.length : 0} 个匹配`;
  }
  if (toolName === "project_read") return `已读取 ${value.path ?? "项目文件"}`;
  if (toolName === "explore_project") {
    return `证据包包含 ${Array.isArray(value.symbols) ? value.symbols.length : 0} 个符号、${Array.isArray(value.edges) ? value.edges.length : 0} 条关系`;
  }
  if (toolName === "article_assets") {
    return `读取 ${Array.isArray(value.assets) ? value.assets.length : 0} 项素材`;
  }
  if (toolName === "propose_article_revision") return "文章修改提案已生成";
  return "执行完成";
}

function formatJson(value: unknown): string {
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * 工具调用块（Codex 风格）。
 * 标题行显示图标 + 中文名 + 状态 + 一行摘要，点击展开查看完整输入参数 / 输出 / 错误。
 */
export function ToolCallBlock({
  part,
}: {
  part: Record<string, unknown>;
}) {
  const [open, setOpen] = useState(false);

  const toolName =
    part.type === "dynamic-tool" && typeof part.toolName === "string"
      ? part.toolName
      : typeof part.type === "string" && part.type.startsWith("tool-")
        ? part.type.slice(5)
        : typeof part.toolName === "string"
          ? part.toolName
          : "";

  if (!toolName) return null;

  const state = String(part.state ?? "");
  const running =
    state.includes("streaming") || state.includes("input") || state === "call";
  const failed = state === "output-error";
  const errorText = typeof part.errorText === "string" ? part.errorText : "";
  const input = formatJson(part.input);
  const output = formatJson(part.output);
  const label = TOOL_LABELS[toolName] ?? toolName;
  const hasDetail = Boolean(input || output || errorText);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn(
        "rounded-md border bg-muted/25",
        failed &&
          "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40"
      )}
    >
      <CollapsibleTrigger
        className="px-2.5 py-2 text-[11px] hover:bg-muted/40 rounded-md"
      >
        {running ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
        ) : failed ? (
          <X className="h-3.5 w-3.5 text-red-600" />
        ) : (
          <ToolIcon name={toolName} />
        )}
        <span className="font-medium">{label}</span>
        {!running && !failed && hasDetail && (
          <span className="text-muted-foreground truncate">
            {summarizeTool(toolName, part.output, part.errorText)}
          </span>
        )}
      </CollapsibleTrigger>
      {hasDetail && (
        <CollapsibleContent>
          <div className="border-t px-3 py-2 space-y-2 text-[11px]">
            {input && (
              <div>
                <div className="mb-1 font-medium text-muted-foreground">输入</div>
                <pre className="overflow-x-auto rounded bg-muted/60 p-2 text-[10px] leading-5 font-mono">
                  {input}
                </pre>
              </div>
            )}
            {output && (
              <div>
                <div className="mb-1 font-medium text-muted-foreground">输出</div>
                <pre className="overflow-x-auto rounded bg-muted/60 p-2 text-[10px] leading-5 font-mono max-h-60 overflow-y-auto">
                  {output}
                </pre>
              </div>
            )}
            {errorText && (
              <div>
                <div className="mb-1 font-medium text-red-600 dark:text-red-400">错误</div>
                <pre className="overflow-x-auto rounded bg-red-50 p-2 text-[10px] leading-5 font-mono text-red-700 dark:bg-red-950 dark:text-red-300">
                  {errorText}
                </pre>
              </div>
            )}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}
