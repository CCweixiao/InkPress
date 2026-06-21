"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, Send, Palette, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { TiptapEditor } from "./TiptapEditor";
import { LiveDraftPreview } from "./LiveDraftPreview";
import { AIPanel, type AIPanelMode } from "./AIPanel";
import { WeChatPreview } from "@/components/preview/WeChatPreview";
import { PublishDialog } from "@/components/publish/PublishDialog";

export type ThemeOption = {
  id: string;
  name: string;
  cssContent: string;
  codeTheme: string;
  primaryColor: string | null;
  isDefault?: boolean;
};

export type ArticleData = {
  id: string;
  title: string;
  contentMd: string;
  digest: string;
  coverMediaId: string | null;
  coverUrl?: string | null;
  themeId: string | null;
  spaceId: string | null;
  status: string;
};

export function EditorWorkspace({
  article,
  themes,
}: {
  article: ArticleData;
  themes: ThemeOption[];
}) {
  const [title, setTitle] = useState(article.title);
  const [markdown, setMarkdown] = useState(article.contentMd);
  const [digest, setDigest] = useState(article.digest);
  // 默认主题优先：未指定时取 isDefault 主题，再回落 themes[0]
  const defaultThemeId =
    themes.find((t) => t.isDefault)?.id ?? themes[0]?.id ?? null;
  const [themeId, setThemeId] = useState<string | null>(
    article.themeId ?? defaultThemeId
  );
  const [publishOpen, setPublishOpen] = useState(false);
  const [aiMode, setAiMode] = useState<AIPanelMode>("chat");
  // Agent 正文实时预览（不写回正文，仅镜像展示）
  const [liveDraft, setLiveDraft] = useState<{
    markdown: string;
    title?: string;
  } | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle"
  );

  const currentTheme =
    themes.find((t) => t.id === themeId) ??
    themes.find((t) => t.isDefault) ??
    themes[0] ??
    null;

  // 自动保存：固定 5s 防抖，降低流式生成频繁回显时的保存卡顿
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSave = useRef<Partial<ArticleData>>({});
  const save = (patch: Partial<ArticleData>) => {
    setSaveState("saving");
    pendingSave.current = { ...pendingSave.current, ...patch };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const payload = pendingSave.current;
      pendingSave.current = {};
      await fetch(`/api/articles/${article.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 1500);
    }, 5000);
  };

  const flushArticle = async (patch: Partial<ArticleData> = {}) => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const payload: Partial<ArticleData> = {
      ...pendingSave.current,
      title,
      contentMd: markdown,
      digest,
      themeId,
      ...patch,
    };
    pendingSave.current = {};
    setSaveState("saving");
    const response = await fetch(`/api/articles/${article.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error("保存当前文章失败。");
    setSaveState("saved");
    setTimeout(() => setSaveState("idle"), 1500);
  };

  useEffect(() => {
    save({ title });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title]);

  useEffect(() => {
    save({ contentMd: markdown });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markdown]);

  useEffect(() => {
    save({ themeId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeId]);

  // 页面卸载/刷新前立即落盘未保存内容（防止仅改标题未等 5s 防抖就离开导致丢失）
  useEffect(() => {
    const flushPending = () => {
      const pending = pendingSave.current;
      // 合并当前最新值（防抖尚未触发的改动也一并带上）
      const payload = {
        ...pending,
        title,
        contentMd: markdown,
        digest,
        themeId,
      };
      // 优先用 sendBeacon（页面卸载时仍可送达），fetch 会被浏览器取消
      if (navigator.sendBeacon) {
        navigator.sendBeacon(
          `/api/articles/${article.id}`,
          new Blob([JSON.stringify(payload)], { type: "application/json" })
        );
        pendingSave.current = {};
        return;
      }
      // 兜底：同步 fetch（部分浏览器在 unload 阶段不保证送达）
      fetch(`/api/articles/${article.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {});
      pendingSave.current = {};
    };
    window.addEventListener("pagehide", flushPending);
    window.addEventListener("beforeunload", flushPending);
    return () => {
      window.removeEventListener("pagehide", flushPending);
      window.removeEventListener("beforeunload", flushPending);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, markdown, digest, themeId]);

  // 摘要自动保存（AI 生成或手动编辑都会触发）
  useEffect(() => {
    // 仅当摘要与初始值不同时才保存，避免初次挂载空写
    if (digest !== article.digest) {
      save({ digest });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digest]);

  return (
    <div className="h-screen flex flex-col">
      <header className="border-b border-border bg-background/80 backdrop-blur px-4 h-12 flex items-center gap-3 shrink-0">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          返回
        </Link>
        <span className="text-muted-foreground/40">/</span>
        <span className="text-sm font-medium truncate">
          {title || "无标题文章"}
        </span>
      </header>
      <div className="flex-1 flex overflow-hidden">
      {/* 左栏：AI 写作面板 */}
      <aside
        className={`${
          aiMode === "chat" ? "w-[400px]" : "w-72"
        } border-r border-border bg-muted/30 flex flex-col shrink-0 transition-[width] duration-200`}
      >
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">
              {aiMode === "chat" ? "写作助手" : "素材"}
            </h2>
          </div>
          <p className="text-xs text-muted-foreground">
            {aiMode === "chat"
              ? "研究、分析、创作并通过提案安全调整文章"
              : "上传与管理本文素材，可插入正文"}
          </p>
        </div>
        <AIPanel
          onApply={setMarkdown}
          onApplyArticle={(updated) => {
            setTitle(updated.title);
            setMarkdown(updated.contentMd);
            setDigest(updated.digest ?? "");
          }}
          currentMarkdown={markdown}
          articleId={article.id}
          spaceId={article.spaceId}
          onModeChange={setAiMode}
          onFlushArticle={flushArticle}
          onDraftPreview={setLiveDraft}
        />
      </aside>

      {/* 中栏：编辑器 */}
      <main className="flex-1 flex flex-col overflow-hidden bg-background">
        <div className="px-6 py-3 border-b border-border flex items-center gap-3">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="文章标题"
            className="h-8 text-base font-medium border-transparent focus-visible:border-border"
          />
          <span className="text-xs text-muted-foreground w-16 shrink-0">
            {saveState === "saving"
              ? "保存中…"
              : saveState === "saved"
              ? "已保存"
              : ""}
          </span>
          <Button size="sm" onClick={() => setPublishOpen(true)}>
            <Send className="h-4 w-4" />
            发布
          </Button>
        </div>
        {/* Agent 正文实时预览（不写回正文，仅镜像展示；应用需在对话区点「应用修改」） */}
        {liveDraft && (
          <LiveDraftPreview
            draft={liveDraft}
            onClose={() => setLiveDraft(null)}
          />
        )}
        <div className="editor-canvas flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-10 py-6">
            <TiptapEditor value={markdown} onChange={setMarkdown} articleId={article.id} />
          </div>
        </div>
      </main>

      {/* 右栏：公众号实时预览 */}
      <aside className="w-[380px] border-l border-border bg-muted/30 overflow-y-auto shrink-0">
        <div className="px-4 py-2 border-b border-border flex items-center gap-2 bg-background/60">
          <Palette className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <Select value={themeId ?? undefined} onValueChange={setThemeId}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="选择主题" />
            </SelectTrigger>
            <SelectContent>
              {themes.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <WeChatPreview
          markdown={markdown}
          title={title}
          theme={currentTheme}
        />
      </aside>

      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        articleId={article.id}
        title={title}
        digest={digest}
        coverMediaId={article.coverMediaId}
        status={article.status}
        themes={themes}
        defaultThemeId={themeId}
      />
      </div>
    </div>
  );
}
