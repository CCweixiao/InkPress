"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  Sparkles,
  Send,
  Palette,
  ArrowLeft,
  PanelRightClose,
  PanelRightOpen,
  Check,
  Copy,
  MoreHorizontal,
  AlertTriangle,
  CheckCircle2,
  LocateFixed,
  Wand2,
} from "lucide-react";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TiptapEditor } from "./TiptapEditor";
import { AIPanel, type AIPanelMode } from "./AIPanel";
import { WeChatPreview } from "@/components/preview/WeChatPreview";
import { PublishDialog } from "@/components/publish/PublishDialog";
import { ExportArticleButton } from "./ExportArticleButton";

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
  /** P3 文章类型 profile id（前端 badge 展示用）。 */
  profileId?: string | null;
};

type ArticleCheck = {
  id: string;
  message: string;
  line: number;
  fixLabel?: string;
  fix?: (markdown: string) => string;
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
  const [profileId, setProfileId] = useState<string | null>(
    article.profileId ?? null
  );
  // 默认主题优先：未指定时取 isDefault 主题，再回落 themes[0]
  const defaultThemeId =
    themes.find((t) => t.isDefault)?.id ?? themes[0]?.id ?? null;
  const [themeId, setThemeId] = useState<string | null>(
    article.themeId ?? defaultThemeId
  );
  const [publishOpen, setPublishOpen] = useState(false);
  // 公众号预览折叠态：收起后按 4:6 将释放宽度分摊给写作助手(chat 模式)与编辑区
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  const [aiMode, setAiMode] = useState<AIPanelMode>("chat");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle"
  );
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [articleActionsOpen, setArticleActionsOpen] = useState(false);
  const articleChecks = useMemo(() => buildArticleChecks(markdown), [markdown]);
  const editorScrollRef = useRef<HTMLDivElement | null>(null);
  const previewScrollRef = useRef<HTMLElement | null>(null);
  const scrollSyncFrame = useRef<number | null>(null);
  const editorRef = useRef<Editor | null>(null);

  // 稳定回调：TiptapEditor 的 onEditorReady useEffect deps 含 onEditorReady，
  // 用 useCallback 钉住引用避免每次 render 重置 editor。
  const handleEditorReady = useCallback((e: Editor) => {
    editorRef.current = e;
  }, []);

  /** 光标处插入 Markdown（面板点击用；tiptap-markdown 解析为富文本）。 */
  const insertMarkdown = useCallback((md: string) => {
    editorRef.current?.chain().focus().insertContent(md).run();
  }, []);

  /** 读当前选区文本（摘录用；空选区返回 ""）。 */
  const getSelectionText = useCallback(() => {
    const e = editorRef.current;
    if (!e) return "";
    const { from, to } = e.state.selection;
    return e.state.doc.textBetween(from, to, "\n").trim();
  }, []);

  // 摘录反馈内联消息（无 toast 库；2s 后自动清除）
  const [excerptMsg, setExcerptMsg] = useState<string | null>(null);

  async function handleExcerpt() {
    const text = getSelectionText();
    if (!text) {
      setExcerptMsg("请先选中文字");
      window.setTimeout(() => setExcerptMsg(null), 2000);
      return;
    }
    try {
      const res = await fetch("/api/snippets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: text,
          kind: "text",
          sourceArticleId: article.id,
        }),
      });
      setExcerptMsg(res.ok ? "✓ 已保存到灵感" : "保存失败");
    } catch {
      setExcerptMsg("保存失败");
    }
    window.setTimeout(() => setExcerptMsg(null), 2000);
  }

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
      profileId,
      ...patch,
    };
    pendingSave.current = {};
    setSaveState("saving");
    const response = await fetch(`/api/articles/${article.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`保存当前文章失败。${detail ? `（${detail}）` : ""}`);
    }
    setSaveState("saved");
    setTimeout(() => setSaveState("idle"), 1500);
  };

  const copyMarkdown = async () => {
    if (!markdown.trim()) return;
    await navigator.clipboard.writeText(markdown);
    setCopyState("copied");
    window.setTimeout(() => setCopyState("idle"), 1200);
  };

  const locateCheck = (line: number) => {
    const scroller = editorScrollRef.current;
    if (!scroller) return;
    const totalLines = Math.max(1, markdown.split(/\r?\n/).length);
    const ratio = Math.max(0, Math.min(1, (line - 1) / totalLines));
    scroller.scrollTo({
      top: ratio * (scroller.scrollHeight - scroller.clientHeight),
      behavior: "smooth",
    });
  };

  const applyCheckFix = (check: ArticleCheck) => {
    if (!check.fix) return;
    setMarkdown(check.fix(markdown));
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

  useEffect(() => {
    if (profileId !== (article.profileId ?? null)) {
      save({ profileId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  useEffect(() => {
    const editorScroller = editorScrollRef.current;
    const previewScroller = previewScrollRef.current;
    if (!editorScroller || !previewScroller || previewCollapsed) return;

    const syncPreviewScroll = () => {
      if (scrollSyncFrame.current !== null) {
        window.cancelAnimationFrame(scrollSyncFrame.current);
      }
      scrollSyncFrame.current = window.requestAnimationFrame(() => {
        const editorMax =
          editorScroller.scrollHeight - editorScroller.clientHeight;
        const previewMax =
          previewScroller.scrollHeight - previewScroller.clientHeight;

        if (editorMax <= 0 || previewMax <= 0) return;

        const ratio = editorScroller.scrollTop / editorMax;
        previewScroller.scrollTop = Math.max(0, Math.min(previewMax, ratio * previewMax));
      });
    };

    editorScroller.addEventListener("scroll", syncPreviewScroll, {
      passive: true,
    });
    syncPreviewScroll();

    return () => {
      editorScroller.removeEventListener("scroll", syncPreviewScroll);
      if (scrollSyncFrame.current !== null) {
        window.cancelAnimationFrame(scrollSyncFrame.current);
        scrollSyncFrame.current = null;
      }
    };
  }, [previewCollapsed]);

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
        profileId,
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
  }, [title, markdown, digest, themeId, profileId]);

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
        <span className="text-sm font-medium truncate min-w-0">
          {title || "无标题文章"}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-8 gap-1.5 text-muted-foreground"
          onClick={() => setPreviewCollapsed((v) => !v)}
          title={previewCollapsed ? "展开公众号预览" : "收起公众号预览"}
          aria-label={previewCollapsed ? "展开公众号预览" : "收起公众号预览"}
        >
          {previewCollapsed ? (
            <PanelRightOpen className="h-4 w-4" />
          ) : (
            <PanelRightClose className="h-4 w-4" />
          )}
          <span className="hidden md:inline">
            {previewCollapsed ? "展开预览" : "收起预览"}
          </span>
        </Button>
      </header>
      <div className="flex-1 flex overflow-hidden">
      {/* 左栏：AI 写作面板 */}
      <aside
        className={`${
          previewCollapsed && aiMode === "chat"
            ? "flex-[2] min-w-0"
            : aiMode === "chat"
            ? "w-[400px] shrink-0"
            : "w-72 shrink-0"
        } border-r border-border bg-muted/30 flex flex-col transition-[width] duration-200`}
      >
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">
              {aiMode === "chat" ? "写作助手" : aiMode === "snippets" ? "灵感" : "素材"}
            </h2>
          </div>
          <p className="text-xs text-muted-foreground">
            {aiMode === "chat"
              ? "研究、分析、创作并通过提案安全调整文章"
              : aiMode === "snippets"
                ? "点击或拖拽灵感素材插入正文"
                : "上传与管理本文素材，可插入正文"}
          </p>
        </div>
        <AIPanel
          onApply={setMarkdown}
          onApplyDigest={setDigest}
          onApplyArticle={(updated) => {
            setTitle(updated.title);
            setMarkdown(updated.contentMd);
            setDigest(updated.digest ?? "");
          }}
          currentMarkdown={markdown}
          articleId={article.id}
          spaceId={article.spaceId}
          profileId={profileId}
          onProfileChange={setProfileId}
          onModeChange={setAiMode}
          onFlushArticle={flushArticle}
          onInsertMarkdown={insertMarkdown}
        />
      </aside>

      {/* 中栏：编辑器 */}
      <main
        className={`${
          previewCollapsed && aiMode === "chat" ? "flex-[3]" : "flex-1"
        } flex flex-col overflow-hidden bg-background`}
      >
        <div className="px-6 py-3 border-b border-border flex items-center gap-3">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="文章标题"
            className="h-8 min-w-0 flex-1 text-base font-medium border-transparent focus-visible:border-border"
          />
          <span className="text-xs text-muted-foreground w-16 shrink-0">
            {saveState === "saving"
              ? "保存中…"
              : saveState === "saved"
              ? "已保存"
              : ""}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExcerpt}
            title="把当前选区文字保存为灵感素材"
            className="h-8 shrink-0"
          >
            保存选区为灵感
          </Button>
          {excerptMsg && (
            <span className="text-xs text-muted-foreground shrink-0">{excerptMsg}</span>
          )}
          <Popover open={articleActionsOpen} onOpenChange={setArticleActionsOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                title="更多文章操作"
                aria-label="更多文章操作"
              >
                <MoreHorizontal className="h-4 w-4" />
                <span className="hidden xl:inline">更多</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-3">
              <div className="space-y-3">
                <div>
                  <div className="text-sm font-medium">文章操作</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    导出和复制类操作默认收起，减少标题栏占用
                  </div>
                </div>
                <ExportArticleButton
                  articleId={article.id}
                  markdown={markdown}
                  title={title}
                  className="w-full justify-between"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={copyMarkdown}
                  disabled={!markdown.trim()}
                  title="复制 Markdown 源文"
                  aria-label="复制 Markdown 源文"
                  className="w-full justify-start"
                >
                  {copyState === "copied" ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  {copyState === "copied" ? "已复制" : "复制 Markdown"}
                </Button>
                <div className="rounded-lg border border-border bg-muted/30 p-2.5">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                    {articleChecks.length > 0 ? (
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    )}
                    排版检查
                    {articleChecks.length > 0 && (
                      <span className="ml-auto rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                        {articleChecks.length}
                      </span>
                    )}
                  </div>
                  {articleChecks.length > 0 ? (
                    <div className="space-y-1.5">
                      {articleChecks.slice(0, 5).map((item) => (
                        <div
                          key={item.id}
                          className="rounded-md bg-background/70 p-2 text-xs text-muted-foreground"
                        >
                          <div className="leading-5">{item.message}</div>
                          <div className="mt-1 flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => locateCheck(item.line)}
                              className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-accent hover:text-accent-foreground"
                            >
                              <LocateFixed className="h-3 w-3" />
                              定位
                            </button>
                            {item.fix && (
                              <button
                                type="button"
                                onClick={() => applyCheckFix(item)}
                                className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-accent hover:text-accent-foreground"
                              >
                                <Wand2 className="h-3 w-3" />
                                {item.fixLabel ?? "修复"}
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">暂无明显问题</p>
                  )}
                </div>
              </div>
            </PopoverContent>
          </Popover>
          <Button size="sm" onClick={() => setPublishOpen(true)}>
            <Send className="h-4 w-4" />
            发布
          </Button>
        </div>
        <div ref={editorScrollRef} className="editor-canvas flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-10 py-6">
            <TiptapEditor
              value={markdown}
              onChange={setMarkdown}
              articleId={article.id}
              onEditorReady={handleEditorReady}
            />
          </div>
        </div>
      </main>

      {/* 右栏：公众号实时预览 */}
      <aside
        ref={previewScrollRef}
        className={`${
          previewCollapsed ? "hidden" : "w-[380px] shrink-0"
        } border-l border-border bg-muted/30 overflow-y-auto transition-[width] duration-200`}
      >
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

function buildArticleChecks(markdown: string): ArticleCheck[] {
  const checks: ArticleCheck[] = [];
  const lines = markdown.split(/\r?\n/);
  let maxHeadingLevel = 0;

  for (const [lineIndex, line] of lines.entries()) {
    const heading = /^(#{1,6})\s+/.exec(line);
    if (!heading) continue;
    const level = heading[1].length;
    if (maxHeadingLevel > 0 && level > maxHeadingLevel + 1) {
      checks.push({
        id: "heading-jump",
        message: `标题层级从 H${maxHeadingLevel} 跳到 H${level}`,
        line: lineIndex + 1,
        fixLabel: "拉平层级",
        fix: normalizeHeadingLevels,
      });
      break;
    }
    maxHeadingLevel = Math.max(maxHeadingLevel, level);
  }

  const emptyLinkLine = lines.findIndex((line) => /\[[^\]]+\]\(\s*\)/.test(line));
  if (emptyLinkLine >= 0) {
    checks.push({
      id: "empty-link",
      message: "存在空链接",
      line: emptyLinkLine + 1,
      fixLabel: "移除空链接",
      fix: (md) => md.replace(/\[([^\]]+)\]\(\s*\)/g, "$1"),
    });
  }
  const emptyImageAltLine = lines.findIndex((line) => /!\[\s*\]\([^)]+\)/.test(line));
  if (emptyImageAltLine >= 0) {
    checks.push({
      id: "image-alt",
      message: "存在缺少说明文字的图片",
      line: emptyImageAltLine + 1,
      fixLabel: "补说明",
      fix: (md) => md.replace(/!\[\s*\]\(([^)]+)\)/g, "![图片]($1)"),
    });
  }
  const wideTableLine = lines.findIndex(
    (line) => line.trim().startsWith("|") && line.split("|").length > 8
  );
  if (wideTableLine >= 0) {
    checks.push({
      id: "wide-table",
      message: "存在列数偏多的表格，移动端可能较难阅读",
      line: wideTableLine + 1,
    });
  }
  const longParagraph = findLongParagraph(markdown);
  if (longParagraph) {
    checks.push({
      id: "long-paragraph",
      message: "存在较长段落，可考虑拆分",
      line: longParagraph.line,
      fixLabel: "自动拆段",
      fix: splitLongParagraphs,
    });
  }

  return checks;
}

function normalizeHeadingLevels(markdown: string): string {
  let maxLevel = 0;
  return markdown.replace(/^(#{1,6})(\s+)/gm, (full, hashes: string, space: string) => {
    const level = hashes.length;
    const nextLevel = maxLevel > 0 && level > maxLevel + 1 ? maxLevel + 1 : level;
    maxLevel = Math.max(maxLevel, nextLevel);
    return `${"#".repeat(nextLevel)}${space}`;
  });
}

function findLongParagraph(markdown: string): { line: number } | null {
  let line = 1;
  for (const paragraph of markdown.split(/\n{2,}/)) {
    if (paragraph.replace(/\s+/g, "").length > 500) return { line };
    line += paragraph.split(/\r?\n/).length + 1;
  }
  return null;
}

function splitLongParagraphs(markdown: string): string {
  return markdown
    .split(/(\n{2,})/)
    .map((part) => {
      if (/^\n{2,}$/.test(part) || part.replace(/\s+/g, "").length <= 500) {
        return part;
      }
      return part.replace(/([。！？.!?])(?=\S)/g, "$1\n\n");
    })
    .join("");
}
