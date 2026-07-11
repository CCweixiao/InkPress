"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sparkles, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MarkdownEditor } from "@/components/editor/MarkdownEditor";
import { TagInput } from "./TagInput";
import { useSnippetCreateForm } from "./use-snippet-create-form";
import type { SnippetItem } from "./types";

/**
 * 全局「快速记录灵感」弹窗：Cmd/Ctrl+Shift+N 呼出（非输入态）。
 * 挂在根 layout，与 SnippetCreateBar 共用 useSnippetCreateForm。
 * 成功 → 内联「✓ 灵感已保存」800ms → 关闭；在 /snippets 页则 router.refresh 列表。
 */
export function SnippetQuickDialog() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleCreated = (snippet: SnippetItem) => {
    window.dispatchEvent(
      new CustomEvent<SnippetItem>("inkpress:snippet-created", {
        detail: snippet,
      })
    );
    if (pathname === "/snippets") router.refresh();
  };

  const form = useSnippetCreateForm({ onCreated: handleCreated });
  const { reset: resetForm } = form;

  // 全局触发（输入态跳过）：主入口 Cmd/Ctrl+Shift+N，兼容旧 Alt+N。
  useEffect(() => {
    const openDialog = () => setOpen(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "n" && e.key !== "N") return;
      const primaryShortcut = (e.metaKey || e.ctrlKey) && e.shiftKey;
      const legacyShortcut = e.altKey && !e.metaKey && !e.ctrlKey;
      if (!primaryShortcut && !legacyShortcut) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || t?.isContentEditable) return;
      e.preventDefault();
      openDialog();
    };
    window.addEventListener("inkpress:open-snippet-quick-dialog", openDialog);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("inkpress:open-snippet-quick-dialog", openDialog);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // 关闭时重置反馈 + 表单
  useEffect(() => {
    if (!open) {
      setSaved(false);
      setErrorMsg(null);
      resetForm();
    }
  }, [open, resetForm]);

  const handleSubmit = async () => {
    const ok = await form.submit();
    if (ok) {
      setSaved(true);
      setErrorMsg(null);
      window.setTimeout(() => setOpen(false), 800);
    } else {
      setErrorMsg("保存失败");
      window.setTimeout(() => setErrorMsg(null), 2000);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void handleSubmit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[86vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            快速记录灵感
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3" onKeyDown={handleKeyDown}>
          <div className="snippet-editor-dialog rounded-xl border border-border bg-background p-3">
            <MarkdownEditor
              value={form.content}
              onChange={form.setContent}
              mode="snippet"
              placeholder={
                form.pasting
                  ? "上传图片中…"
                  : "写下闪念，支持 Markdown 和粘贴图片"
              }
            />
          </div>
          <TagInput
            value={form.tags}
            onChange={form.setTags}
            suggestions={form.existingTags ?? []}
            placeholder="标签…"
          />
          {errorMsg && <p className="text-xs text-destructive">{errorMsg}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-sm text-muted-foreground hover:text-foreground px-3 py-1.5"
            >
              取消（Esc）
            </button>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={!form.canSubmit || saved || form.pasting}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {form.isSubmitting || form.pasting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : saved ? (
                "✓ 灵感已保存"
              ) : (
                "保存（Ctrl+Enter）"
              )}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
