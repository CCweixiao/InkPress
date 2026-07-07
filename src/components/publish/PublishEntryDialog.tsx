"use client";

import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { allChannelMeta, getChannelMeta } from "@/lib/publish/channels/meta";
import type { ThemeOption } from "@/components/editor/EditorWorkspace";
import { WechatPublishPanel } from "./WechatPublishPanel";
import { ExportHtmlPanel } from "./ExportHtmlPanel";

/**
 * 多渠道发布统一入口。
 *
 * 对外保持与原 PublishDialog 一致的 props（EditorWorkspace 调用点零改动）。
 * 内部两态：未选渠道 → 渠道选择网格；已选 → 按 channel.kind 路由到对应面板
 * （api-push → WechatPublishPanel；export-html → ExportHtmlPanel）。
 */
export function PublishEntryDialog({
  open,
  onOpenChange,
  articleId,
  title,
  digest,
  coverMediaId,
  status,
  themes,
  defaultThemeId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  articleId: string;
  title: string;
  digest: string;
  coverMediaId: string | null;
  status: string;
  themes: ThemeOption[];
  defaultThemeId: string | null;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const channel = selectedId ? getChannelMeta(selectedId) ?? null : null;

  function handleOpenChange(v: boolean) {
    // 关闭弹窗时重置渠道选择，下次打开回到选择器
    if (!v) setSelectedId(null);
    onOpenChange(v);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        {channel && (
          <button
            onClick={() => setSelectedId(null)}
            className="flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> 返回选择渠道
          </button>
        )}

        {!channel ? (
          <ChannelSelector onSelect={setSelectedId} />
        ) : channel.kind === "api-push" ? (
          <WechatPublishPanel
            articleId={articleId}
            title={title}
            digest={digest}
            coverMediaId={coverMediaId}
            status={status}
            themes={themes}
            defaultThemeId={defaultThemeId}
            onClose={() => onOpenChange(false)}
          />
        ) : (
          <ExportHtmlPanel
            articleId={articleId}
            themes={themes}
            defaultThemeId={defaultThemeId}
            channel={channel}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** 渠道选择网格（数据驱动：遍历 allChannels 声明式渲染）。 */
function ChannelSelector({ onSelect }: { onSelect: (id: string) => void }) {
  const channels = allChannelMeta();
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">选择发布渠道</h2>
        <p className="text-sm text-muted-foreground">
          同一篇文章、同一套主题，按目标渠道产出对应格式。
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {channels.map((c) => {
          const Icon = c.icon;
          return (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
              className="flex flex-col items-start gap-2 rounded-lg border border-border p-4 text-left transition-colors hover:border-primary hover:bg-accent"
            >
              <div className="flex items-center gap-2">
                <Icon className="h-5 w-5 text-primary" />
                <span className="font-medium">{c.label}</span>
              </div>
              <span className="text-xs text-muted-foreground">
                {c.kind === "api-push" ? "API 推送草稿箱" : "复制 HTML 粘贴"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
