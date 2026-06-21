"use client";

import { useState } from "react";
import { ChevronDown, Eye, X } from "lucide-react";
import { Markdown } from "@/components/ai/Markdown";

/**
 * Agent 正文实时预览面板。
 * 流式期间镜像 Agent 生成的 Markdown，默认展开方便边生成边看；
 * 可折叠、可关闭。此面板**不写回正文**，正式落盘需在对话区点「应用修改」。
 */
export function LiveDraftPreview({
  draft,
  onClose,
}: {
  draft: { markdown: string; title?: string };
  onClose: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const chars = draft.markdown.length;

  return (
    <div className="border-b border-primary/20 bg-primary/[0.03]">
      <div className="mx-auto max-w-3xl px-6 py-1.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
            title={collapsed ? "展开预览" : "收起预览"}
          >
            <Eye className="h-3.5 w-3.5" />
            AI 实时生成预览
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${collapsed ? "" : "rotate-180"}`}
            />
          </button>
          <span className="text-[10px] text-muted-foreground">
            {chars.toLocaleString()} 字 · 仅供参考，应用修改需在对话区确认
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="关闭预览"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {!collapsed && (
          <div className="max-h-72 overflow-y-auto border-t border-primary/15 px-1 py-2">
            <Markdown className="text-sm leading-6">
              {draft.markdown || "（生成中…）"}
            </Markdown>
          </div>
        )}
      </div>
    </div>
  );
}
