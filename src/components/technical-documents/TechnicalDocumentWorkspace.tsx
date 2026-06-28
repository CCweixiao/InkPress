"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Download, Eye, EyeOff, FileClock, RotateCcw, Search, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { WritingAssistant } from "@/components/editor/WritingAssistant";
import { ArticleDiffDialog, type ProposalDetail } from "@/components/editor/ArticleDiffDialog";
import { splitLines } from "@/components/editor/article-diff-utils";
import { MermaidMarkdownPreview } from "./MermaidMarkdownPreview";

type TechnicalDocumentData = {
  id: string;
  title: string;
  documentType: string;
  projectId: string;
  markdown: string;
  snapshotHash: string;
  currentSnapshotHash: string;
  stale: boolean;
};

type VersionItem = {
  id: string;
  version: number;
  title: string;
  markdown: string;
  snapshotHash: string;
  createdAt: string;
};

export function TechnicalDocumentWorkspace({
  initialDocument,
}: {
  initialDocument: TechnicalDocumentData;
}) {
  const [title, setTitle] = useState(initialDocument.title);
  const [markdown, setMarkdown] = useState(initialDocument.markdown);
  const [snapshotHash, setSnapshotHash] = useState(initialDocument.snapshotHash);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [preview, setPreview] = useState(true);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [pendingVersionId, setPendingVersionId] = useState<string | null>(null);
  const [reviewVersion, setReviewVersion] = useState<VersionItem | null>(null);
  const [versions, setVersions] = useState<VersionItem[]>([]);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorScrollRef = useRef<HTMLDivElement>(null);
  const previewScrollRef = useRef<HTMLElement>(null);
  const scrollSyncFrame = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    setSaveState("saving");
    const response = await fetch(`/api/technical-documents/${initialDocument.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, markdown, snapshotHash }),
    });
    if (!response.ok) throw new Error("保存技术文档失败。");
    setSaveState("saved");
    window.setTimeout(() => setSaveState("idle"), 1200);
  }, [initialDocument.id, markdown, snapshotHash, title]);

  useEffect(() => {
    setSaveState("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 1200);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [flush]);

  // 编辑区 textarea 自适应高度：让外层容器承担滚动，滚动联动才能生效
  // 预览区显隐会改变编辑区宽度（换行变化），需一并重新测量
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [markdown, preview]);

  // 编辑区 ↔ 预览区滚动联动（按比例同步，rAF 节流）
  useEffect(() => {
    if (!preview) return;
    const editorScroller = editorScrollRef.current;
    const previewScroller = previewScrollRef.current;
    if (!editorScroller || !previewScroller) return;

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
        previewScroller.scrollTop = Math.max(
          0,
          Math.min(previewMax, ratio * previewMax)
        );
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
  }, [preview]);

  async function openVersions() {
    const response = await fetch(
      `/api/technical-documents/${initialDocument.id}/versions`
    );
    const data = await response.json().catch(() => ({}));
    if (response.ok) setVersions(data.versions ?? []);
    setVersionsOpen(true);
  }

  async function rollbackVersion(version: {
    id: string;
    version: number;
    title: string;
  }) {
    const ok = await confirm({
      title: `回滚到 v${version.version}？`,
      description: "当前编辑器内容将被替换为该版本的内容。",
      confirmText: "回滚",
    });
    if (!ok) return;
    setPendingVersionId(version.id);
    try {
      const response = await fetch(
        `/api/technical-documents/${initialDocument.id}/versions/${version.id}/rollback`,
        { method: "POST" }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "回滚失败。");
      const document = data.document;
      if (document) {
        setTitle(document.title);
        setMarkdown(document.markdown);
        setSnapshotHash(document.snapshotHash ?? "");
      }
      setVersionsOpen(false);
    } catch (error) {
      alert(error instanceof Error ? error.message : "回滚失败。");
    } finally {
      setPendingVersionId(null);
    }
  }

  async function deleteVersion(version: { id: string; version: number }) {
    const ok = await confirm({
      title: `删除 v${version.version}？`,
      description: "删除后不可恢复。",
      variant: "destructive",
      confirmText: "删除",
    });
    if (!ok) return;
    setPendingVersionId(version.id);
    try {
      const response = await fetch(
        `/api/technical-documents/${initialDocument.id}/versions/${version.id}`,
        { method: "DELETE" }
      );
      if (!response.ok) throw new Error("删除版本失败。");
      setVersions((items) => items.filter((item) => item.id !== version.id));
    } catch (error) {
      alert(error instanceof Error ? error.message : "删除版本失败。");
    } finally {
      setPendingVersionId(null);
    }
  }

  // 历史版本 ↔ 当前版本差异审查：以历史版本为基准，当前内容为对照
  const reviewProposal: ProposalDetail | null = useMemo(
    () =>
      reviewVersion
        ? {
            id: reviewVersion.id,
            proposalKind: "technical-document",
            targetId: initialDocument.id,
            baseTitle: reviewVersion.title,
            baseMarkdown: reviewVersion.markdown,
            baseDigest: "",
            title,
            markdown,
            digest: null,
            summary: `v${reviewVersion.version} 与当前版本对比`,
            status: "applied",
            stats: {
              oldLines: splitLines(reviewVersion.markdown).length,
              newLines: splitLines(markdown).length,
              changedLines: 0,
            },
          }
        : null,
    [reviewVersion, title, markdown, initialDocument.id]
  );

  // 判定“当前版本”：内容与标题均与编辑器当前状态一致的那条（取最新一条匹配）。
  // 版本列表按 version 倒序返回，故首个匹配即最新。
  const currentVersionId = useMemo(() => {
    for (const item of versions) {
      if (item.markdown === markdown && item.title === title) return item.id;
    }
    return null;
  }, [versions, markdown, title]);

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <aside className="flex w-[400px] shrink-0 flex-col border-r bg-muted/25">
        <WritingAssistant
          targetKind="technical-document"
          targetId={initialDocument.id}
          currentMarkdown={markdown}
          onFlushTarget={flush}
          onApplyTechnicalDocument={(document) => {
            setTitle(document.title);
            setMarkdown(document.markdown);
            setSnapshotHash(document.snapshotHash ?? "");
          }}
        />
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 items-center gap-3 border-b px-4">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="h-8 border-transparent text-base font-medium"
          />
          <span className="w-14 shrink-0 text-xs text-muted-foreground">
            {saveState === "saving" ? "保存中…" : saveState === "saved" ? "已保存" : ""}
          </span>
          <Button
            size="sm"
            variant={preview ? "secondary" : "outline"}
            onClick={() => setPreview((value) => !value)}
          >
            {preview ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            预览
          </Button>
          <Button size="sm" variant="outline" onClick={openVersions}>
            <FileClock className="h-4 w-4" />
            版本
          </Button>
          <Button size="sm" variant="outline" asChild>
            <a href={`/api/technical-documents/${initialDocument.id}/export`}>
              <Download className="h-4 w-4" />
              导出
            </a>
          </Button>
        </div>
        {initialDocument.stale && (
          <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
            <AlertTriangle className="h-4 w-4" />
            当前文档基于旧代码快照。请让 Agent 重新探索后生成更新提案。
          </div>
        )}
        <div ref={editorScrollRef} className="editor-canvas min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-10 py-6">
            <textarea
              ref={textareaRef}
              value={markdown}
              onChange={(event) => setMarkdown(event.target.value)}
              placeholder="让 Agent 探索项目并生成技术文档，或在这里直接编辑 Markdown…"
              className="block min-h-[60vh] w-full resize-none overflow-hidden rounded-md bg-transparent font-mono text-sm leading-6 focus:outline-none"
            />
          </div>
        </div>
      </main>

      {preview && (
        <aside ref={previewScrollRef} className="w-[420px] shrink-0 overflow-y-auto border-l bg-background">
          <div className="sticky top-0 z-10 border-b bg-background/95 px-4 py-3 text-xs font-medium text-muted-foreground backdrop-blur">
            Markdown / Mermaid 预览
          </div>
          <MermaidMarkdownPreview markdown={markdown} />
        </aside>
      )}

      <Dialog open={versionsOpen} onOpenChange={setVersionsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>技术文档版本</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-auto">
            {!versions.length && (
              <div className="py-8 text-center text-sm text-muted-foreground">
                应用 Agent 提案后会生成版本记录
              </div>
            )}
            {versions.map((version) => (
              <div key={version.id} className="rounded-lg border p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 font-medium">
                      v{version.version} · {version.title}
                      {version.id === currentVersionId && (
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                          当前
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {new Date(version.createdAt).toLocaleString("zh-CN")} ·{" "}
                      {version.snapshotHash ? version.snapshotHash.slice(0, 10) : "无代码快照"}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {version.id !== currentVersionId && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setReviewVersion(version)}
                      >
                        <Search className="h-3.5 w-3.5" />
                        查看
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pendingVersionId === version.id}
                      onClick={() => rollbackVersion(version)}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      回滚
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      disabled={pendingVersionId === version.id}
                      onClick={() => deleteVersion(version)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      删除
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <ArticleDiffDialog
        open={!!reviewVersion}
        onOpenChange={(open) => !open && setReviewVersion(null)}
        proposal={reviewProposal}
      />
      {confirmDialog}
    </div>
  );
}
