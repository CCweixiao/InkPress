"use client";

import { Bot, FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ArticleMaterialsPanel } from "./ArticleMaterialsPanel";
import { WritingAssistant } from "./WritingAssistant";

export type AIPanelMode = "chat" | "materials";

type Model = { id: string; name: string; isDefault: boolean };
type Provider = {
  id: string;
  name: string;
  models: Model[];
  isDefault: boolean;
};

export function AIPanel({
  onApply,
  onApplyArticle,
  currentMarkdown,
  articleId,
  spaceId,
  onModeChange,
  onFlushArticle,
  onApplyDigest,
}: {
  onApply: (md: string) => void;
  onApplyArticle: (article: {
    title: string;
    contentMd: string;
    digest: string | null;
  }) => void;
  currentMarkdown: string;
  articleId: string;
  spaceId?: string | null;
  onModeChange?: (mode: AIPanelMode) => void;
  onFlushArticle: (patch?: {
    title?: string;
    contentMd?: string;
    digest?: string;
  }) => Promise<void>;
  /** Agent 摘要生成后镜像到编辑器 digest 字段。 */
  onApplyDigest?: (digest: string) => void;
}) {
  const [mode, setModeState] = useState<AIPanelMode>("chat");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");

  function setMode(next: AIPanelMode) {
    setModeState(next);
    onModeChange?.(next);
  }

  useEffect(() => {
    fetch("/api/ai/providers")
      .then((response) => response.json())
      .then((data: { providers: Provider[] }) => {
        const list = data.providers ?? [];
        setProviders(list);
        const provider = list.find((item) => item.isDefault) ?? list[0];
        if (!provider) return;
        setProviderId(provider.id);
        setModelId(
          (provider.models.find((model) => model.isDefault) ?? provider.models[0])
            ?.id ?? ""
        );
      })
      .catch(() => {});
  }, []);

  const activeProvider = providers.find((provider) => provider.id === providerId);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="p-3 pb-0">
        <div className="flex gap-1 rounded-md bg-muted p-1">
          <button
            onClick={() => setMode("chat")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1 rounded py-1.5 text-xs font-medium transition-colors",
              mode === "chat" ? "bg-background shadow-sm" : "text-muted-foreground"
            )}
          >
            <Bot className="h-3.5 w-3.5" />
            写作助手
          </button>
          <button
            onClick={() => setMode("materials")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1 rounded py-1.5 text-xs font-medium transition-colors",
              mode === "materials" ? "bg-background shadow-sm" : "text-muted-foreground"
            )}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            素材
          </button>
        </div>
      </div>

      {mode !== "materials" && providers.length > 0 && (
        <div className="grid grid-cols-2 gap-2 px-3 pt-3">
          <Select
            value={providerId}
            onValueChange={(value) => {
              setProviderId(value);
              const provider = providers.find((item) => item.id === value);
              setModelId(
                (provider?.models.find((model) => model.isDefault) ??
                  provider?.models[0])
                  ?.id ?? ""
              );
            }}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="供应商" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {providers.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {provider.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select value={modelId} onValueChange={setModelId}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="模型" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {activeProvider?.models.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      )}

      {mode === "chat" && (
        <WritingAssistant
          articleId={articleId}
          currentMarkdown={currentMarkdown}
          providerId={providerId}
          modelId={modelId}
          onApplyArticle={onApplyArticle}
          onApplyDigest={onApplyDigest}
          onFlushArticle={onFlushArticle}
        />
      )}

      {mode === "materials" && (
        <div className="flex-1 overflow-y-auto p-3">
          <ArticleMaterialsPanel
            articleId={articleId}
            spaceId={spaceId}
            onInsert={(markdown) =>
              onApply((currentMarkdown ? `${currentMarkdown}\n` : "") + markdown)
            }
          />
        </div>
      )}
    </div>
  );
}
