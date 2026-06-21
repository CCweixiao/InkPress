"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2, FileText, FolderOpen, Image as ImageIcon, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type ResultItem = {
  id: string;
  title: string;
  subtitle?: string;
  href: string;
};

type SearchResult = {
  articles: ResultItem[];
  spaces: ResultItem[];
  assets: ResultItem[];
  skills: ResultItem[];
};

const EMPTY: SearchResult = { articles: [], spaces: [], assets: [], skills: [] };

/**
 * 全局搜索触发器 + 结果弹窗。
 * - 顶部搜索图标按钮 → 打开弹窗
 * - 输入 debounce 300ms → fetch /api/search?q=
 * - 结果分类（文章/空间/素材/技能）分区展示，点击跳转
 * - ESC 可关闭；点遮罩不关闭（固定弹窗，避免误触丢失输入）
 */
export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SearchResult>(EMPTY);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 弹窗打开时聚焦输入框
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      // 关闭时清空
      setQ("");
      setResult(EMPTY);
    }
  }, [open]);

  // debounce 搜索
  useEffect(() => {
    if (!open) return;
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResult(EMPTY);
      setLoading(false);
      return;
    }
    setLoading(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`);
        if (res.ok) setResult(await res.json());
        else setResult(EMPTY);
      } catch {
        setResult(EMPTY);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q, open]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  const total =
    result.articles.length +
    result.spaces.length +
    result.assets.length +
    result.skills.length;
  const trimmed = q.trim();
  const showEmpty = !loading && trimmed.length >= 2 && total === 0;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-accent"
        title="搜索"
      >
        <Search className="h-4 w-4" />
        <span className="hidden md:inline">搜索</span>
      </button>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (v) setOpen(true);
        }}
      >
        <DialogContent
          className="max-w-2xl top-[15%] translate-y-0 max-h-[70vh] flex flex-col p-0"
          // 隐藏默认 X 关闭按钮（输入区已有 ESC 关闭 + 底部关闭按钮），避免与输入框尾端重叠
          hideClose
          // 固定弹窗：点遮罩不关闭（ESC 关闭）
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>全局搜索</DialogTitle>
            <DialogDescription>搜索文章、空间、素材、技能</DialogDescription>
          </DialogHeader>

          {/* 搜索输入区（固定顶部） */}
          <div className="border-b border-border p-4 shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜索文章、空间、素材、技能…"
                className="pl-9"
                onKeyDown={(e) => {
                  if (e.key === "Escape") setOpen(false);
                }}
              />
              {loading && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
          </div>

          {/* 结果区（滚动） */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {trimmed.length < 2 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                输入至少 2 个字符开始搜索
              </p>
            ) : showEmpty ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                未找到匹配「{trimmed}」的结果
              </p>
            ) : (
              <>
                {result.articles.length > 0 && (
                  <ResultSection
                    title="文章"
                    icon={<FileText className="h-4 w-4" />}
                    items={result.articles}
                    onSelect={go}
                  />
                )}
                {result.spaces.length > 0 && (
                  <ResultSection
                    title="空间"
                    icon={<FolderOpen className="h-4 w-4" />}
                    items={result.spaces}
                    onSelect={go}
                  />
                )}
                {result.assets.length > 0 && (
                  <ResultSection
                    title="素材"
                    icon={<ImageIcon className="h-4 w-4" />}
                    items={result.assets}
                    onSelect={go}
                  />
                )}
                {result.skills.length > 0 && (
                  <ResultSection
                    title="技能"
                    icon={<Sparkles className="h-4 w-4" />}
                    items={result.skills}
                    onSelect={go}
                  />
                )}
              </>
            )}
          </div>

          {/* 关闭按钮 */}
          <div className="border-t border-border p-3 shrink-0 flex justify-end">
            <button
              onClick={() => setOpen(false)}
              className="text-xs text-muted-foreground hover:text-foreground px-3 py-1"
            >
              关闭（ESC）
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ResultSection({
  title,
  icon,
  items,
  onSelect,
}: {
  title: string;
  icon: React.ReactNode;
  items: ResultItem[];
  onSelect: (href: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5 text-muted-foreground">
        {icon}
        <span className="text-xs font-semibold">{title}（{items.length}）</span>
      </div>
      <div className="space-y-0.5">
        {items.map((item) => (
          <button
            key={`${title}-${item.id}`}
            onClick={() => onSelect(item.href)}
            className={cn(
              "w-full text-left px-3 py-2 rounded-md hover:bg-accent transition-colors group"
            )}
          >
            <div className="text-sm font-medium truncate group-hover:text-primary">
              {item.title}
            </div>
            {item.subtitle && (
              <div className="text-xs text-muted-foreground truncate">
                {item.subtitle}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
