"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TiptapEditor } from "./TiptapEditor";
import { AIPanel } from "./AIPanel";
import { WeChatPreview } from "@/components/preview/WeChatPreview";
import { PublishDialog } from "@/components/publish/PublishDialog";

export type ThemeOption = {
  id: string;
  name: string;
  cssContent: string;
  codeTheme: string;
  primaryColor: string | null;
};

export type ArticleData = {
  id: string;
  title: string;
  contentMd: string;
  digest: string;
  coverMediaId: string | null;
  themeId: string | null;
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
  const [themeId, setThemeId] = useState<string | null>(
    article.themeId ?? themes[0]?.id ?? null
  );
  const [publishOpen, setPublishOpen] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle"
  );

  const currentTheme = themes.find((t) => t.id === themeId) ?? themes[0] ?? null;

  // debounce 自动保存
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = (patch: Partial<ArticleData>) => {
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await fetch(`/api/articles/${article.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 1500);
    }, 600);
  };

  useEffect(() => {
    save({ title });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title]);

  useEffect(() => {
    save({ contentMd: markdown });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markdown]);

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* 左栏：AI 生成面板 */}
      <aside className="w-72 border-r border-border bg-muted/30 flex flex-col shrink-0">
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">AI 生成</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            填写主题、要求与素材，生成公众号文章
          </p>
        </div>
        <AIPanel onApply={setMarkdown} currentMarkdown={markdown} />
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
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-8 py-6">
            <TiptapEditor value={markdown} onChange={setMarkdown} />
          </div>
        </div>
      </main>

      {/* 右栏：公众号实时预览 */}
      <aside className="w-[380px] border-l border-border bg-muted/30 overflow-y-auto shrink-0">
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
        digest={article.digest}
        coverMediaId={article.coverMediaId}
        themes={themes}
        defaultThemeId={themeId}
      />
    </div>
  );
}
