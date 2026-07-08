"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sparkles, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { TagInput } from "./TagInput";
import { useSnippetCreateForm } from "./use-snippet-create-form";
import type { SnippetItem } from "./types";

/**
 * 全局「快速记录灵感」弹窗：Alt+N 呼出（非输入态）。
 * 挂在根 layout，与 SnippetCreateBar 共用 useSnippetCreateForm。
 * 成功 → 内联「✓ 灵感已保存」800ms → 关闭；在 /snippets 页则 router.refresh 列表。
 */
export function SnippetQuickDialog() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleCreated = (_snippet: SnippetItem) => {
    if (pathname === "/snippets") router.refresh();
  };

  const form = useSnippetCreateForm({ onCreated: handleCreated });
  const { reset: resetForm } = form;

  // Alt+N 全局触发（输入态跳过，避免 Mac Option 插特殊字符）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "n" && e.key !== "N") return;
      if (!e.altKey || e.metaKey || e.ctrlKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || t?.isContentEditable) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            快速记录灵感
          </DialogTitle>
          <DialogDescription>
            随时按下 Alt+N 呼出，Ctrl+Enter 保存。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <textarea
            value={form.content}
            onChange={(e) => form.setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={form.handlePaste}
            placeholder={
              form.pasting ? "上传图片中…" : "记录一个灵感…（可粘贴图片）"
            }
            aria-label="记录灵感"
            rows={4}
            autoFocus
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm resize-none placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <TagInput
            value={form.tags}
            onChange={form.setTags}
            suggestions={form.existingTags ?? []}
            placeholder="标签…（回车或逗号添加）"
          />
          {errorMsg && <p className="text-xs text-destructive">{errorMsg}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-sm text-muted-foreground hover:text-foreground px-3 py-1.5"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={!form.canSubmit || saved}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {form.isSubmitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : saved ? (
                "✓ 灵感已保存"
              ) : (
                "保存"
              )}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
