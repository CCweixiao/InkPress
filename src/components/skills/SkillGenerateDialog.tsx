"use client";

import { useEffect, useState } from "react";
import { Loader2, Sparkles, Wand2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Provider = {
  id: string;
  name: string;
  isDefault: boolean;
  models: { id: string; name: string; isDefault: boolean }[];
};

/**
 * AI 生成技能：填用途描述 → generateText 一次产出 → 切到可编辑预览 → 确认保存（POST /api/skills）。
 * 保存逻辑复用 SkillEditDialog 的 POST 入口，故本组件确认后调用 onGenerated 把草稿交给父组件。
 */
export function SkillGenerateDialog({
  open,
  onOpenChange,
  onGenerated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** 生成完成并点「保存」后回调（父组件用 SkillEditDialog 落库） */
  onGenerated: (draft: { name: string; description: string; manual: string; promptHint: string }) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  // 预览态
  const [draft, setDraft] = useState<{
    name: string;
    description: string;
    manual: string;
  } | null>(null);

  useEffect(() => {
    if (open) {
      setError("");
      if (!draft) {
        setPrompt("");
      }
      // 加载供应商列表
      fetch("/api/ai/providers")
        .then((r) => r.json())
        .then((data) => {
          const list: Provider[] = data.providers ?? [];
          setProviders(list);
          const def = list.find((p) => p.isDefault) ?? list[0];
          if (def) {
            setProviderId(def.id);
            const m = def.models.find((mm) => mm.isDefault) ?? def.models[0];
            setModelId(m?.id ?? "");
          }
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const currentProvider = providers.find((p) => p.id === providerId);

  async function generate() {
    setError("");
    if (!prompt.trim()) {
      setError("请描述你想要的技能用途");
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch("/api/skills/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt,
          providerId: providerId || undefined,
          modelId: modelId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "生成失败");
        return;
      }
      setDraft({ name: data.name, description: data.description, manual: data.manual });
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
    } finally {
      setGenerating(false);
    }
  }

  function confirmSave() {
    if (!draft) return;
    onGenerated({ ...draft, promptHint: prompt });
    // 关闭本弹窗
    setDraft(null);
    onOpenChange(false);
  }

  function close() {
    setDraft(null);
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        // 弹窗固定：onOpenChange(false) 仅来自 X 按钮等显式关闭，正常放行
        if (!v) setDraft(null);
        onOpenChange(v);
      }}
    >
      <DialogContent
        className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col skill-form"
        // 固定弹窗：始终阻止点遮罩 / ESC 自动关闭，仅允许显式按钮（取消/X）关闭
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-4 w-4" />
            AI 生成技能
          </DialogTitle>
          <DialogDescription>
            描述用途，AI 会按 skill-creator 方法论生成可编辑的技能草稿，确认后保存入库。
          </DialogDescription>
        </DialogHeader>

        {!draft ? (
          <div className="flex-1 overflow-auto space-y-5 pr-1">
            <div className="space-y-2">
              <Label htmlFor="gen-prompt" className="text-[13px] font-medium">
                用途 / 场景描述 <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="gen-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
                className="leading-relaxed"
                placeholder="例：撰写小红书风格的种草笔记，强情绪、短段落、多 emoji、结尾带互动话题"
              />
              <p className="text-xs text-muted-foreground">
                描述越具体，生成的技能越贴合你的写作场景。
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-[13px] font-medium">供应商</Label>
                <Select value={providerId} onValueChange={(v) => { setProviderId(v); const p = providers.find((x) => x.id === v); const m = p?.models.find((mm) => mm.isDefault) ?? p?.models[0]; setModelId(m?.id ?? ""); }}>
                  <SelectTrigger className="h-10"><SelectValue placeholder="默认" /></SelectTrigger>
                  <SelectContent>
                    {providers.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-[13px] font-medium">模型</Label>
                <Select value={modelId} onValueChange={setModelId}>
                  <SelectTrigger className="h-10"><SelectValue placeholder="默认" /></SelectTrigger>
                  <SelectContent>
                    {(currentProvider?.models ?? []).map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {error && (
              <p className="text-sm text-destructive bg-destructive/5 border border-destructive/20 rounded-md px-3 py-2">
                {error}
              </p>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-auto space-y-4 pr-1">
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
              ✓ 已生成草稿，可在下方编辑后保存。原始描述已记录为 promptHint。
            </div>
            <div className="space-y-2">
              <Label className="text-[13px] font-medium">
                名称 <span className="text-destructive">*</span>
              </Label>
              <Input className="h-10" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label className="text-[13px] font-medium">
                描述（触发依据） <span className="text-destructive">*</span>
              </Label>
              <Input className="h-10" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label className="text-[13px] font-medium">指令正文</Label>
              <Textarea
                value={draft.manual}
                onChange={(e) => setDraft({ ...draft, manual: e.target.value })}
                rows={12}
                className="font-mono text-xs leading-relaxed"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={close} disabled={generating}>
            {draft ? "放弃" : "取消"}
          </Button>
          {!draft ? (
            <Button onClick={generate} disabled={generating}>
              {generating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              生成
            </Button>
          ) : (
            <Button onClick={confirmSave}>保存为用户技能</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
