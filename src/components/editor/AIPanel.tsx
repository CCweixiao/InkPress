"use client";

import { useCompletion } from "@ai-sdk/react";
import { Sparkles, Loader2, Check, SquarePen, ListTree, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { cn } from "@/lib/utils";

type Mode = "fast" | "sections";

type OutlineSection = { heading: string; summary: string };

export function AIPanel({
  onApply,
  currentMarkdown,
}: {
  onApply: (md: string) => void;
  currentMarkdown: string;
}) {
  const [mode, setMode] = useState<Mode>("fast");
  const [topic, setTopic] = useState("");
  const [requirements, setRequirements] = useState("");
  const [materials, setMaterials] = useState("");
  const [applied, setApplied] = useState(false);

  // 分节模式状态
  const [outline, setOutline] = useState<{
    title: string;
    sections: OutlineSection[];
  } | null>(null);
  const [sectionProgress, setSectionProgress] = useState<{
    current: number;
    total: number;
    heading: string;
  } | null>(null);
  const [sectionText, setSectionText] = useState("");
  const [outlining, setOutlining] = useState(false);

  // 快速模式：单次流式
  const { completion, input, handleSubmit, isLoading, error, stop, setInput } =
    useCompletion({
      api: "/api/ai/generate",
      body: { topic, requirements, materials },
      onFinish: () => setApplied(false),
    });

  function apply(md: string) {
    if (md.trim()) {
      onApply(md);
      setApplied(true);
    }
  }

  async function generateSections() {
    if (!topic.trim()) return;
    setOutlining(true);
    setError(null);
    setOutline(null);
    setSectionText("");
    setSectionProgress(null);
    try {
      const res = await fetch("/api/ai/outline", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic, requirements, materials }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "大纲生成失败");
      setOutline(data.outline);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "大纲生成失败");
    } finally {
      setOutlining(false);
    }
  }

  async function startSectionGeneration() {
    if (!outline) return;
    setError(null);
    setApplied(false);
    setSectionText("");
    setSectionProgress({ current: 0, total: outline.sections.length, heading: "" });

    try {
      const res = await fetch("/api/ai/generate-sections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          outline,
          requirements,
          materials,
        }),
      });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "生成失败");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let full = `# ${outline.title}\n\n`;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // 按行处理哨兵
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const m = line.match(
            /^<section index="(\d+)" total="(\d+)" heading="([^"]*)".*\/>$/
          );
          if (m) {
            setSectionProgress({
              current: Number(m[1]),
              total: Number(m[2]),
              heading: decodeAttr(m[3]),
            });
          } else if (line.trim()) {
            full += line + "\n";
            setSectionText(full);
          }
        }
      }
      if (buffer.trim()) {
        full += buffer + "\n";
        setSectionText(full);
      }
      setSectionProgress(null);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "生成失败");
      setSectionProgress(null);
    }
  }

  // error 状态统一管理（useCompletion 的 error + 本地）
  const [localError, setError] = useState<string | null>(null);
  function setErrorMsg(s: string | null) {
    setError(s);
  }
  const displayError = error?.message || localError;
  const busy =
    isLoading ||
    outlining ||
    sectionProgress !== null;

  // 当前可应用的内容
  const applyable = mode === "fast" ? completion : sectionText;

  return (
    <div className="p-4 flex-1 overflow-y-auto flex flex-col">
      {/* 模式切换 */}
      <div className="flex gap-1 mb-3 rounded-md bg-muted p-1">
        <button
          onClick={() => setMode("fast")}
          className={cn(
            "flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-xs font-medium transition-colors",
            mode === "fast" ? "bg-background shadow-sm" : "text-muted-foreground"
          )}
        >
          <Zap className="h-3.5 w-3.5" />
          快速生成
        </button>
        <button
          onClick={() => setMode("sections")}
          className={cn(
            "flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-xs font-medium transition-colors",
            mode === "sections"
              ? "bg-background shadow-sm"
              : "text-muted-foreground"
          )}
        >
          <ListTree className="h-3.5 w-3.5" />
          分节生成
        </button>
      </div>

      <label className="text-xs font-medium text-muted-foreground mb-1">
        文章主题 *
      </label>
      <textarea
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        placeholder="如：2025 年大模型发展趋势"
        className="w-full min-h-[48px] rounded-md border border-input bg-background px-3 py-2 text-xs mb-2 resize-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      />

      <label className="text-xs font-medium text-muted-foreground mb-1">
        写作要求
      </label>
      <textarea
        value={requirements}
        onChange={(e) => setRequirements(e.target.value)}
        placeholder="面向技术读者，分三点，口语化…"
        className="w-full min-h-[48px] rounded-md border border-input bg-background px-3 py-2 text-xs mb-2 resize-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      />

      <label className="text-xs font-medium text-muted-foreground mb-1">
        参考素材
      </label>
      <textarea
        value={materials}
        onChange={(e) => setMaterials(e.target.value)}
        placeholder="粘贴原文/要点/链接"
        className="w-full min-h-[64px] rounded-md border border-input bg-background px-3 py-2 text-xs mb-3 resize-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      />

      {/* 隐藏 input 触发 useCompletion */}
      <input type="hidden" value={input} onChange={(e) => setInput(e.target.value)} />

      {/* 操作按钮 */}
      {mode === "fast" ? (
        busy ? (
          <Button type="button" size="sm" variant="outline" className="w-full" onClick={stop}>
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
              const evt = new Event("submit", { bubbles: true, cancelable: true });
              handleSubmit(evt as unknown as React.FormEvent<HTMLFormElement>);
            }}
          >
            <Sparkles className="h-4 w-4" />
            生成整篇文章
          </Button>
        )
      ) : (
        <div className="space-y-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-full"
            disabled={!topic.trim() || busy}
            onClick={generateSections}
          >
            {outlining ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ListTree className="h-4 w-4" />
            )}
            {outline ? "重新生成大纲" : "生成大纲"}
          </Button>
          {outline && !sectionProgress && (
            <Button
              type="button"
              size="sm"
              className="w-full"
              disabled={busy}
              onClick={startSectionGeneration}
            >
              <Sparkles className="h-4 w-4" />
              按大纲逐节生成
            </Button>
          )}
        </div>
      )}

      {displayError && (
        <div className="mt-3 rounded-md bg-red-50 border border-red-200 p-2 text-xs text-red-700">
          {displayError}
        </div>
      )}

      {/* 分节进度 */}
      {mode === "sections" && outline && (
        <div className="mt-3 rounded-md border border-border bg-muted/30 p-2">
          <div className="text-xs font-medium mb-1 truncate">
            {outline.title}
          </div>
          <ol className="text-xs text-muted-foreground space-y-0.5 list-decimal list-inside">
            {outline.sections.map((s, i) => (
              <li
                key={i}
                className={cn(
                  "truncate",
                  sectionProgress &&
                    sectionProgress.current === i + 1 &&
                    "text-primary font-medium"
                )}
              >
                {s.heading}
              </li>
            ))}
          </ol>
          {sectionProgress && (
            <div className="mt-2 flex items-center gap-2 text-xs">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>
                第 {sectionProgress.current}/{sectionProgress.total} 节：
                {sectionProgress.heading || "生成中…"}
              </span>
            </div>
          )}
        </div>
      )}

      {/* 流式预览 */}
      {(isLoading || applyable) && (
        <div className="mt-3 flex-1 min-h-0 flex flex-col">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-muted-foreground">
              生成预览
            </span>
            {applyable.trim() && !busy && (
              <button
                onClick={() => apply(applyable)}
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
            {applyable || "等待生成…"}
          </div>
        </div>
      )}

      {currentMarkdown && !applyable && !busy && mode === "fast" && (
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

function decodeAttr(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
