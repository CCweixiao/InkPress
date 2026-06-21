"use client";

import { useState } from "react";
import { Plus, Save, Trash2, Settings, Check, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { WeChatPreview } from "@/components/preview/WeChatPreview";
import { cn } from "@/lib/utils";

export type ThemeItem = {
  id: string;
  name: string;
  cssContent: string;
  codeTheme: string;
  primaryColor: string;
  isBuiltIn: boolean;
  isDefault: boolean;
};

const CODE_THEMES = [
  "atom-one-dark",
  "atom-one-light",
  "github",
  "monokai",
  "vs2015",
  "xcode",
];

const NAME_MAX = 20;

const SAMPLE_MD = `# 欢迎使用 InkPress

这是一段**示例文字**，用于预览主题效果。

## 二级标题

### 核心能力：稳定、清晰、可扩展

- 列表项一
- 列表项二

> 引用块：这里是一段引用文字。

正文中的 \`inlineCode()\` 会使用更轻量的行内代码样式。

\`\`\`js
function hello(name) {
  return "Hello, " + name;
}
\`\`\`

[这是一个链接](https://example.com)`;

export function ThemeManager({ themes }: { themes: ThemeItem[] }) {
  const [list, setList] = useState<ThemeItem[]>(themes);
  const [selectedId, setSelectedId] = useState<string>(themes[0]?.id ?? "");
  const selected = list.find((t) => t.id === selectedId) ?? null;
  // 保存反馈：success / error 内联提示
  const [feedback, setFeedback] = useState<
    { type: "success" | "error"; message: string } | null
  >(null);
  const [saving, setSaving] = useState(false);
  // 设置面板（每行设置图标）
  const [settingsFor, setSettingsFor] = useState<ThemeItem | null>(null);
  const [settingDefault, setSettingDefault] = useState(false);
  const { confirm, dialog } = useConfirm();

  function showFeedback(type: "success" | "error", message: string) {
    setFeedback({ type, message });
    setTimeout(() => setFeedback(null), 3000);
  }

  function patchTheme(id: string, patch: Partial<ThemeItem>) {
    setList((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...patch } : t))
    );
  }

  /** 客户端校验：名称必填且 ≤20 字符；CSS 必填 */
  function validate(t: ThemeItem): string | null {
    if (!t.name.trim()) return "主题名称不能为空";
    if (t.name.length > NAME_MAX) return `主题名称不能超过 ${NAME_MAX} 个字符`;
    if (!t.cssContent.trim()) return "主题 CSS 不能为空";
    return null;
  }

  async function saveTheme(id: string) {
    const t = list.find((x) => x.id === id);
    if (!t) return;
    const err = validate(t);
    if (err) {
      showFeedback("error", err);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/themes/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: t.name,
          cssContent: t.cssContent,
          codeTheme: t.codeTheme,
          primaryColor: t.primaryColor,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data.error && typeof data.error === "string"
            ? data.error
            : data.error?.formErrors?.[0]) || "保存失败"
        );
      }
      showFeedback("success", "保存成功");
    } catch (e) {
      showFeedback("error", e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function createTheme() {
    setSaving(true);
    try {
      const res = await fetch("/api/themes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "新主题",
          cssContent: "/* 在此编辑主题 CSS */",
          codeTheme: "atom-one-dark",
          primaryColor: "#3f51b5",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "新建失败");
      }
      const { theme } = await res.json();
      setList((prev) => [...prev, theme]);
      setSelectedId(theme.id);
    } catch (e) {
      showFeedback("error", e instanceof Error ? e.message : "新建失败");
    } finally {
      setSaving(false);
    }
  }

  async function deleteTheme(id: string) {
    const t = list.find((x) => x.id === id);
    if (!t) return;
    const ok = await confirm({
      title: "删除主题",
      description: `确定要删除主题「${t.name}」吗？此操作不可恢复。`,
      variant: "destructive",
      confirmText: "删除",
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/themes/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const { error } = await res.json();
        showFeedback("error", error || "删除失败");
        return;
      }
      setList((prev) => {
        const next = prev.filter((x) => x.id !== id);
        if (selectedId === id) setSelectedId(next[0]?.id ?? "");
        return next;
      });
      showFeedback("success", "已删除");
    } catch (e) {
      showFeedback("error", e instanceof Error ? e.message : "删除失败");
    }
  }

  /** 设为默认（设置面板内） */
  async function setAsDefault(id: string) {
    setSettingDefault(true);
    try {
      const res = await fetch(`/api/themes/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "设置默认失败");
      }
      const { theme: updated } = await res.json();
      setList((prev) =>
        prev.map((t) => ({
          ...t,
          isDefault: t.id === updated.id,
        }))
      );
      setSettingsFor((cur) => (cur ? { ...cur, isDefault: true } : cur));
      showFeedback("success", "已设为默认主题");
    } catch (e) {
      showFeedback("error", e instanceof Error ? e.message : "设置默认失败");
    } finally {
      setSettingDefault(false);
    }
  }

  const validationError = selected ? validate(selected) : null;
  const nameTooLong = selected ? selected.name.length > NAME_MAX : false;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr_380px] gap-6">
      {/* 左：主题列表 */}
      <div className="space-y-2">
        <Button
          onClick={createTheme}
          variant="outline"
          size="sm"
          className="w-full"
          disabled={saving}
        >
          <Plus className="h-4 w-4" />
          新建自定义主题
        </Button>
        {list.map((t) => (
          <div
            key={t.id}
            className={cn(
              "relative w-full px-3 py-2 rounded-md border transition-colors",
              t.id === selectedId
                ? "border-primary bg-accent"
                : "border-border hover:bg-accent/50"
            )}
          >
            <button
              onClick={() => setSelectedId(t.id)}
              className="w-full text-left"
            >
              <div className="flex items-center justify-between gap-2 pr-6">
                <span className="text-sm font-medium truncate">{t.name}</span>
                <div className="flex items-center gap-1 shrink-0">
                  {t.isDefault && <Badge variant="default">默认</Badge>}
                  {t.isBuiltIn && !t.isDefault && (
                    <Badge variant="secondary">内置</Badge>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span
                  className="w-3 h-3 rounded-full border"
                  style={{ background: t.primaryColor }}
                />
                <span className="text-xs text-muted-foreground">{t.codeTheme}</span>
              </div>
            </button>
            {/* 设置图标：点击弹出操作面板（stopPropagation 避免触发选中） */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSettingsFor(t);
              }}
              title="主题设置"
              className="absolute top-2 right-2 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <Settings className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* 中：编辑区 */}
      {selected ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>
                主题名称
                <span className="ml-1 text-xs text-muted-foreground">
                  （最多 {NAME_MAX} 字）
                </span>
              </Label>
              <Input
                value={selected.name}
                onChange={(e) => patchTheme(selected.id, { name: e.target.value })}
              />
              {nameTooLong && (
                <p className="text-xs text-destructive">
                  名称不能超过 {NAME_MAX} 个字符（当前 {selected.name.length}）
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>主题色</Label>
              <div className="flex gap-2">
                <Input
                  type="color"
                  value={selected.primaryColor}
                  onChange={(e) =>
                    patchTheme(selected.id, { primaryColor: e.target.value })
                  }
                  className="w-12 h-9 p-1"
                />
                <Input
                  value={selected.primaryColor}
                  onChange={(e) =>
                    patchTheme(selected.id, { primaryColor: e.target.value })
                  }
                />
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>代码高亮主题</Label>
            <Select
              value={selected.codeTheme}
              onValueChange={(v) => patchTheme(selected.id, { codeTheme: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CODE_THEMES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>主题 CSS（裸选择器，可用 var(--md-primary-color)）</Label>
            <Textarea
              value={selected.cssContent}
              onChange={(e) =>
                patchTheme(selected.id, { cssContent: e.target.value })
              }
              className="font-mono text-xs min-h-[320px]"
            />
            {!selected.cssContent.trim() && (
              <p className="text-xs text-destructive">主题 CSS 不能为空</p>
            )}
          </div>

          {/* 反馈提示 */}
          {feedback && (
            <div
              className={cn(
                "flex items-center gap-2 text-sm rounded-md px-3 py-2",
                feedback.type === "success"
                  ? "bg-green-50 text-green-700"
                  : "bg-red-50 text-red-700"
              )}
            >
              {feedback.type === "success" && (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              )}
              <span>{feedback.message}</span>
            </div>
          )}

          <div className="flex justify-between">
            {!selected.isBuiltIn ? (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => deleteTheme(selected.id)}
                disabled={saving}
              >
                <Trash2 className="h-4 w-4" />
                删除主题
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground self-center">
                内置主题可直接编辑保存
              </span>
            )}
            <Button
              size="sm"
              onClick={() => saveTheme(selected.id)}
              disabled={saving || validationError !== null}
              title={validationError ?? undefined}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              保存
            </Button>
          </div>
        </div>
      ) : (
        <div className="text-muted-foreground text-sm flex items-center justify-center">
          选择左侧主题开始编辑
        </div>
      )}

      {/* 右：实时预览 */}
      <div className="border-l border-border pl-6 -mr-6 pr-6 bg-muted/20 -my-8 py-8">
        <WeChatPreview
          markdown={SAMPLE_MD}
          title={selected?.name ?? "主题预览"}
          theme={selected}
        />
      </div>

      {/* 设置面板（每行设置图标触发） */}
      <Dialog
        open={settingsFor !== null}
        onOpenChange={(v) => {
          if (!v) setSettingsFor(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>主题设置</DialogTitle>
            <DialogDescription>
              {settingsFor?.name} — 管理主题选项
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {/* 当前仅支持「设为默认」，预留可扩展结构 */}
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">默认主题</p>
                <p className="text-xs text-muted-foreground">
                  新建文章与发布预览默认使用此主题
                </p>
              </div>
              {settingsFor?.isDefault ? (
                <Badge variant="default">
                  <Check className="h-3 w-3 mr-1" />
                  当前默认
                </Badge>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={settingDefault}
                  onClick={() => settingsFor && setAsDefault(settingsFor.id)}
                >
                  {settingDefault && (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  )}
                  设为默认
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 删除确认弹窗 */}
      {dialog}
    </div>
  );
}
