"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

type ImportResult = { filename: string; ok: boolean; id?: string; error?: string };

/**
 * 导入文章（可多选 .zip / .md）：每个文件独立解析、独立成败。
 * - 单个文件成功：直接跳转到新文章编辑器。
 * - 多个文件 / 有失败：刷新首页 + 弹窗汇总（成功 N 篇 + 失败项及原因）。
 * spaceId=null 表示导入到未分类。
 */
export function ImportArticleButton({
  spaceId,
  label = "导入文章",
  variant = "default",
  size = "default",
}: {
  spaceId?: string | null;
  label?: string;
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "default" | "sm" | "lg" | "icon";
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);
  const router = useRouter();

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // 清空，便于下次重选同一批文件
    if (files.length === 0) return;

    setImporting(true);
    try {
      const fd = new FormData();
      for (const f of files) fd.append("file", f);
      fd.append("spaceId", spaceId ?? "");

      const res = await fetch("/api/articles/import", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        window.alert(data.error || "导入失败。");
        return;
      }

      const results: ImportResult[] = data.results ?? [];
      const ok = results.filter((r) => r.ok);
      const failed = results.filter((r) => !r.ok);

      // 单文件成功：直接跳编辑器
      if (ok.length === 1 && files.length === 1 && ok[0].id) {
        window.location.href = `/editor/${ok[0].id}`;
        return;
      }

      router.refresh();
      const lines = [`成功导入 ${ok.length} 篇。`];
      if (failed.length > 0) {
        lines.push(
          `失败 ${failed.length} 项：` +
            failed.map((f) => `${f.filename}（${f.error}）`).join("；")
        );
      }
      window.alert(lines.join("\n"));
    } catch {
      window.alert("网络错误，导入失败。");
    } finally {
      setImporting(false);
    }
  }

  return (
    <>
      <Button
        variant={variant}
        size={size}
        disabled={importing}
        onClick={() => inputRef.current?.click()}
        title="从 ZIP 或 Markdown 导入文章（可多选）"
      >
        <Upload className="h-4 w-4" />
        {importing ? "导入中…" : label}
      </Button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".zip,.md,.markdown,.mdown"
        className="hidden"
        onChange={(e) => void onChange(e)}
      />
    </>
  );
}
