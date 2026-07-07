"use client";

import { useState } from "react";
import { Plus, Save, Trash2, Settings, Check, Loader2, CheckCircle2, Eye } from "lucide-react";
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

const SAMPLE_MD = `# AI 产品发布复盘：从想法到多渠道分发

> 摘要：这是一篇用于主题预览的长文样稿，覆盖**摘要文字**、段落、列表、表格、数学表达式、脚注、代码片段与流程图。它的目标不是解释功能，而是让你快速判断主题在真实文章里的阅读节奏。

好的排版不只是换一组颜色。它需要在段落间距、章节分割线、行间距、字体大小、引用块、表格密度与代码块细节之间保持稳定秩序。比如正文里的 \`conversionRate()\` 应该被轻轻托住，而不是抢走标题的注意力。

## 1. 关键结论

### 为什么要看复杂样稿

- **段落节奏**：连续三段正文时，行距要松，段距要稳。
- **章节层级**：一级标题负责定调，二级标题负责切换场景，三级标题负责落点。
- **信息组件**：表格、代码、公式、流程图不能像临时贴片。

任务清单也常出现在技术文章和项目复盘中：

- [x] 支持多渠道 HTML 导出
- [x] 保留公众号草稿箱发布链路
- [ ] 继续补充更多平台的真实粘贴验证

## 2. 数据与判断

一段简单的增长模型可以写作行内公式 $CTR = clicks / impressions$，也可以写成独立公式：

$$
score = \\frac{quality \\times reach}{latency + 1}
$$

| 模块 | 指标 | 当前表现 | 下一步 |
|---|---:|---:|---|
| 编辑器 | 首屏可读性 | 92% | 优化空态 |
| 主题 | 复杂元素覆盖 | 78% | 补充公式/表格 |
| 发布 | 渠道适配 | 85% | 增加粘贴测试 |

## 3. 实现片段

\`\`\`ts
type PublishChannel = "wechat" | "zhihu" | "juejin" | "generic";

function conversionRate(clicks: number, impressions: number) {
  if (impressions === 0) return 0;
  return Number((clicks / impressions).toFixed(4));
}
\`\`\`

## 4. 流程图

\`\`\`mermaid
flowchart TD
  A[Markdown 原文] --> B[主题 CSS]
  B --> C[Juice 内联]
  C --> D{发布渠道}
  D --> E[公众号草稿箱]
  D --> F[可粘贴 HTML]
\`\`\`

## 5. 延伸阅读

引用块适合放判断边界：

> 如果主题只能在短段落里好看，它还不算成熟。真正高级的样式，需要让长文、表格、代码与注释共同存在时仍然安静、有序。

最后是一条脚注示例：主题灵感可以来自开源文档系统，但最终需要服务当前产品的发布场景。[^theme]

[^theme]: 预览样稿会随渲染能力持续扩展。`;

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
  // 全屏预览抽屉：按需打开，避免常驻预览挤占编辑区宽度
  const [previewOpen, setPreviewOpen] = useState(false);
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
    <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6">
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
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPreviewOpen(true)}
              >
                <Eye className="h-4 w-4" />
                预览
              </Button>
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
        </div>
      ) : (
        <div className="text-muted-foreground text-sm flex items-center justify-center">
          选择左侧主题开始编辑
        </div>
      )}

      {/* 全屏预览抽屉：边改边看，按需打开，避免常驻预览挤占编辑区宽度 */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>主题预览{selected ? `：${selected.name}` : ""}</DialogTitle>
            <DialogDescription>
              示例文本在当前主题下的渲染效果，关闭后继续编辑。
            </DialogDescription>
          </DialogHeader>
          <WeChatPreview
            markdown={SAMPLE_MD}
            title={selected?.name ?? "主题预览"}
            theme={selected}
          />
        </DialogContent>
      </Dialog>

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
