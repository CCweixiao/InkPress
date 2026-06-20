"use client";

import { useState } from "react";
import { Plus, Save, Trash2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { WeChatPreview } from "@/components/preview/WeChatPreview";
import { cn } from "@/lib/utils";

export type ThemeItem = {
  id: string;
  name: string;
  cssContent: string;
  codeTheme: string;
  primaryColor: string;
  isBuiltIn: boolean;
};

const CODE_THEMES = [
  "atom-one-dark",
  "atom-one-light",
  "github",
  "monokai",
  "vs2015",
  "xcode",
];

const SAMPLE_MD = `# 欢迎使用 InkPress

这是一段**示例文字**，用于预览主题效果。

## 二级标题

- 列表项一
- 列表项二

> 引用块：这里是一段引用文字。

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

  async function patchTheme(id: string, patch: Partial<ThemeItem>) {
    setList((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...patch } : t))
    );
  }

  async function saveTheme(id: string) {
    const t = list.find((x) => x.id === id);
    if (!t) return;
    await fetch(`/api/themes/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: t.name,
        cssContent: t.cssContent,
        codeTheme: t.codeTheme,
        primaryColor: t.primaryColor,
      }),
    });
  }

  async function createTheme() {
    const res = await fetch("/api/themes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "新主题",
        cssContent: "",
        codeTheme: "atom-one-dark",
        primaryColor: "#3f51b5",
      }),
    });
    const { theme } = await res.json();
    setList((prev) => [...prev, theme]);
    setSelectedId(theme.id);
  }

  async function deleteTheme(id: string) {
    const res = await fetch(`/api/themes/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const { error } = await res.json();
      alert(error || "删除失败");
      return;
    }
    setList((prev) => prev.filter((t) => t.id !== id));
    if (selectedId === id) setSelectedId(list[0]?.id ?? "");
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr_380px] gap-6">
      {/* 左：主题列表 */}
      <div className="space-y-2">
        <Button onClick={createTheme} variant="outline" size="sm" className="w-full">
          <Plus className="h-4 w-4" />
          新建自定义主题
        </Button>
        {list.map((t) => (
          <button
            key={t.id}
            onClick={() => setSelectedId(t.id)}
            className={cn(
              "w-full text-left px-3 py-2 rounded-md border transition-colors",
              t.id === selectedId
                ? "border-primary bg-accent"
                : "border-border hover:bg-accent/50"
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{t.name}</span>
              {t.isBuiltIn && <Badge variant="secondary">内置</Badge>}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span
                className="w-3 h-3 rounded-full border"
                style={{ background: t.primaryColor }}
              />
              <span className="text-xs text-muted-foreground">{t.codeTheme}</span>
            </div>
          </button>
        ))}
      </div>

      {/* 中：编辑区 */}
      {selected ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>主题名称</Label>
              <Input
                value={selected.name}
                onChange={(e) => patchTheme(selected.id, { name: e.target.value })}
              />
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
          </div>
          <div className="flex justify-between">
            {!selected.isBuiltIn ? (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => deleteTheme(selected.id)}
              >
                <Trash2 className="h-4 w-4" />
                删除主题
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground self-center">
                内置主题可直接编辑保存
              </span>
            )}
            <Button size="sm" onClick={() => saveTheme(selected.id)}>
              <Save className="h-4 w-4" />
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
    </div>
  );
}
