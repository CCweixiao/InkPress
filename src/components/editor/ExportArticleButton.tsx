"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadBlob } from "@/lib/download";

function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const utf8 = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      return utf8[1];
    }
  }
  const ascii = header.match(/filename="?([^";]+)"?/i);
  return ascii?.[1] ?? null;
}

/**
 * 导出当前文章为 ZIP（正文 MD + 元数据 + 素材，本地素材含二进制）。
 *
 * 走 POST 而非 GET <a href>：把编辑器内存里的最新 markdown 作为 body 发给服务端，
 * 保证导出内容与屏幕一致（不受 5s 防抖自动保存滞后影响）。服务端返回 ZIP blob，浏览器下载。
 */
export function ExportArticleButton({
  articleId,
  markdown,
  title,
  variant = "outline",
  size = "sm",
}: {
  articleId: string;
  markdown: string;
  title: string;
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "default" | "sm" | "lg" | "icon";
}) {
  const [exporting, setExporting] = useState(false);
  const [includeAssets, setIncludeAssets] = useState(true);

  async function onExport() {
    setExporting(true);
    try {
      const res = await fetch(`/api/articles/${articleId}/export`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contentMd: markdown, includeAssets }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        window.alert(data.error || "导出失败。");
        return;
      }
      const blob = await res.blob();
      const safe =
        (title || "article").replace(/[\\/:*?"<>|]/g, "-").trim() || "article";
      const filename =
        filenameFromContentDisposition(res.headers.get("content-disposition")) ??
        `${safe}.zip`;
      downloadBlob(filename, blob);
    } catch {
      window.alert("网络错误，导出失败。");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <label className="flex h-8 items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={includeAssets}
          disabled={exporting}
          onChange={(e) => setIncludeAssets(e.target.checked)}
          className="h-3.5 w-3.5 accent-primary"
        />
        打包素材
      </label>
      <Button
        variant={variant}
        size={size}
        onClick={() => void onExport()}
        disabled={exporting}
        title={includeAssets ? "导出为 ZIP（正文 + 元数据 + 素材）" : "导出为 ZIP（正文 + 元数据）"}
      >
        <Download className="h-4 w-4" />
        {exporting ? "导出中…" : "导出"}
      </Button>
    </div>
  );
}
