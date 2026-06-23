"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Download, FileClock, Loader2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WritingAssistant } from "@/components/editor/WritingAssistant";
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

export function TechnicalDocumentWorkspace({
  initialDocument,
}: {
  initialDocument: TechnicalDocumentData;
}) {
  const [title, setTitle] = useState(initialDocument.title);
  const [markdown, setMarkdown] = useState(initialDocument.markdown);
  const [snapshotHash, setSnapshotHash] = useState(initialDocument.snapshotHash);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [source, setSource] = useState<{
    path: string;
    content: string;
    startLine: number;
    endLine: number;
  } | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState<Array<{
    id: string;
    version: number;
    title: string;
    snapshotHash: string;
    createdAt: string;
  }>>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  async function openSource(input: {
    path: string;
    startLine: number;
    endLine: number;
  }) {
    const query = new URLSearchParams({
      path: input.path,
      startLine: String(input.startLine),
      endLine: String(input.endLine),
    });
    const response = await fetch(
      `/api/technical-documents/${initialDocument.id}/source?${query}`
    );
    const data = await response.json().catch(() => ({}));
    if (response.ok) setSource(data.source);
  }

  async function openVersions() {
    const response = await fetch(
      `/api/technical-documents/${initialDocument.id}/versions`
    );
    const data = await response.json().catch(() => ({}));
    if (response.ok) setVersions(data.versions ?? []);
    setVersionsOpen(true);
  }

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
        <textarea
          value={markdown}
          onChange={(event) => setMarkdown(event.target.value)}
          spellCheck={false}
          className="min-h-0 flex-1 resize-none border-0 bg-background px-8 py-6 font-mono text-sm leading-7 outline-none"
          placeholder="让 Agent 探索项目并生成技术文档，或在这里直接编辑 Markdown…"
        />
      </main>

      <aside className="w-[420px] shrink-0 overflow-y-auto border-l bg-white">
        <div className="sticky top-0 z-10 border-b bg-white/95 px-4 py-3 text-xs font-medium backdrop-blur">
          Markdown / Mermaid 预览
        </div>
        <MermaidMarkdownPreview markdown={markdown} onOpenSource={openSource} />
      </aside>

      <Dialog open={Boolean(source)} onOpenChange={(open) => !open && setSource(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between pr-6 text-sm">
              {source?.path} · L{source?.startLine}-L{source?.endLine}
              <X className="h-4 w-4 opacity-0" />
            </DialogTitle>
          </DialogHeader>
          <pre className="max-h-[70vh] overflow-auto rounded-lg bg-slate-950 p-4 text-xs leading-6 text-slate-100">
            {source?.content}
          </pre>
        </DialogContent>
      </Dialog>

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
                <div className="font-medium">v{version.version} · {version.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {new Date(version.createdAt).toLocaleString("zh-CN")} ·{" "}
                  {version.snapshotHash ? version.snapshotHash.slice(0, 10) : "无代码快照"}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
