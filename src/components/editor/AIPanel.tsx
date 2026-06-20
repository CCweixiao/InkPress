"use client";

import { useCompletion } from "@ai-sdk/react";
import { Sparkles, Loader2, Check, SquarePen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export function AIPanel({
  onApply,
  currentMarkdown,
}: {
  onApply: (md: string) => void;
  currentMarkdown: string;
}) {
  const [topic, setTopic] = useState("");
  const [requirements, setRequirements] = useState("");
  const [materials, setMaterials] = useState("");
  const [applied, setApplied] = useState(false);

  const { completion, input, handleSubmit, isLoading, error, stop, setInput } =
    useCompletion({
      api: "/api/ai/generate",
      body: {
        topic,
        requirements,
        materials,
      },
      onFinish: () => setApplied(false),
    });

  function apply() {
    if (completion.trim()) {
      onApply(completion);
      setApplied(true);
    }
  }

  return (
    <div className="p-4 flex-1 overflow-y-auto flex flex-col">
      <label className="text-xs font-medium text-muted-foreground mb-1">
        文章主题 *
      </label>
      <textarea
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        placeholder="如：2025 年大模型发展趋势"
        className="w-full min-h-[56px] rounded-md border border-input bg-background px-3 py-2 text-xs mb-3 resize-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      />

      <label className="text-xs font-medium text-muted-foreground mb-1">
        写作要求
      </label>
      <textarea
        value={requirements}
        onChange={(e) => setRequirements(e.target.value)}
        placeholder="如：面向技术读者，分三点，口语化，开头抛出问题"
        className="w-full min-h-[56px] rounded-md border border-input bg-background px-3 py-2 text-xs mb-3 resize-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      />

      <label className="text-xs font-medium text-muted-foreground mb-1">
        参考素材
      </label>
      <textarea
        value={materials}
        onChange={(e) => setMaterials(e.target.value)}
        placeholder="粘贴原文、要点或链接（AI 会基于此展开）"
        className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-xs mb-3 resize-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      />

      {/* 隐藏 input 供 useCompletion 的 handleSubmit 触发；实际入参走 body */}
      <input
        type="hidden"
        value={input}
        onChange={(e) => setInput(e.target.value)}
      />

      {isLoading ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-full"
          onClick={stop}
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          生成中…点击停止
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          className="w-full"
          disabled={!topic.trim()}
          onClick={() => {
            setApplied(false);
            // 触发 useCompletion：构造表单事件
            const evt = new Event("submit", {
              bubbles: true,
              cancelable: true,
            });
            handleSubmit(evt as unknown as React.FormEvent<HTMLFormElement>);
          }}
        >
          <Sparkles className="h-4 w-4" />
          生成文章
        </Button>
      )}

      {error && (
        <div className="mt-3 rounded-md bg-red-50 border border-red-200 p-2 text-xs text-red-700">
          {error.message || "生成失败，请检查 AI Key 配置"}
        </div>
      )}

      {/* 流式预览 */}
      {(isLoading || completion) && (
        <div className="mt-3 flex-1 min-h-0 flex flex-col">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-muted-foreground">
              生成预览
            </span>
            {completion.trim() && !isLoading && (
              <button
                onClick={apply}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                {applied ? (
                  <>
                    <Check className="h-3 w-3" />
                    已应用
                  </>
                ) : (
                  <>
                    <SquarePen className="h-3 w-3" />
                    应用到编辑器
                  </>
                )}
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto rounded-md border border-border bg-background p-2 text-xs leading-relaxed whitespace-pre-wrap">
            {completion || "等待生成…"}
          </div>
        </div>
      )}

      {currentMarkdown && !completion && !isLoading && (
        <button
          onClick={() => onApply(currentMarkdown)}
          className="mt-2 w-full text-xs text-muted-foreground hover:text-foreground text-left"
        >
          （编辑器已有内容）
        </button>
      )}
    </div>
  );
}
