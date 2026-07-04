"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface EmailOption {
  email: string;
  name: string | null;
  status: string;
  createdAt?: string;
}

interface EmailComboboxProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  /** 标记是否校验失败（用于红框） */
  invalid?: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 归属用户下拉选择器。
 *
 * 结构：触发按钮 + 下拉面板（顶部嵌入搜索框 + 下方滚动选项列表）。
 *
 * 交互：
 * - 点击按钮展开面板，自动聚焦内部搜索框
 * - 搜索框为空 → 立即拉取最近 50 个用户
 * - 输入非空 → 300ms 防抖模糊匹配，最多 10 条
 * - ↑↓ 选择、Enter 选中（active 项）；若 search 为有效邮箱且无匹配项，Enter 直接提交该邮箱
 * - Escape / 点击外部 关闭面板
 *
 * 实现：
 * - 每次请求带 AbortController，新请求发起时取消上一个，避免乱序回填
 * - 下拉背景使用 `bg-card`（CSS 变量 --card 为不透明色），避免历史 bg-popover 透明问题
 * - 派生 displayedOptions / showLoading 等不在 effect 同步 setState
 */
export function EmailCombobox({
  value,
  onChange,
  placeholder,
  invalid,
}: EmailComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<EmailOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const query = search.trim();
  // 是否允许把 search 当成自定义邮箱提交：必须是合法邮箱且不在当前选项中
  const canCommitCustom =
    query.length > 0 &&
    EMAIL_RE.test(query) &&
    !options.some((o) => o.email.toLowerCase() === query.toLowerCase());

  async function fetchOptions(q: string) {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    try {
      const url = `/api/admin/users/emails${q ? `?q=${encodeURIComponent(q)}` : ""}`;
      const res = await fetch(url, { signal: ctrl.signal });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setOptions([]);
        return;
      }
      setOptions((data.data?.items ?? []) as EmailOption[]);
      setActiveIdx(-1);
    } catch {
      setOptions([]);
    } finally {
      setLoading(false);
    }
  }

  // 打开/关闭面板：通过事件处理器驱动，避免 effect 里同步 setState
  function openPanel() {
    setOpen(true);
    // 用当前 value 作为搜索起点，方便在已有选中基础上微调
    setSearch(value);
    // 下一帧聚焦搜索框（等面板挂载完成）
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  function closePanel() {
    setOpen(false);
    setSearch("");
    setActiveIdx(-1);
  }

  // search 变化时防抖拉取
  useEffect(() => {
    if (!open) return;

    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    const delay = query.length === 0 ? 0 : 300;
    debounceTimer.current = setTimeout(() => {
      void fetchOptions(query);
    }, delay);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [query, open]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        closePanel();
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // 卸载时清理
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  function selectOption(opt: EmailOption) {
    onChange(opt.email);
    closePanel();
  }

  function commitCustom() {
    if (!canCommitCustom) return false;
    onChange(query);
    closePanel();
    return true;
  }

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const max = options.length - 1;
      setActiveIdx((cur) => (cur >= max ? 0 : cur + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const max = options.length - 1;
      setActiveIdx((cur) => (cur <= 0 ? max : cur - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIdx >= 0 && activeIdx < options.length) {
        selectOption(options[activeIdx]);
      } else {
        commitCustom();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      closePanel();
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => (open ? closePanel() : openPanel())}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-1 text-left text-sm shadow-sm transition-colors",
          "hover:bg-muted/40",
          "focus:outline-none focus:ring-1 focus:ring-ring",
          invalid && "border-destructive",
          !value && "text-muted-foreground"
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">
          {value || placeholder || "请选择归属用户"}
        </span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn(
            "h-4 w-4 shrink-0 opacity-50 transition-transform",
            open && "rotate-180"
          )}
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 6" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border border-border bg-card text-card-foreground shadow-md">
          {/* 顶部搜索框 */}
          <div className="border-b border-border p-1.5">
            <div className="relative">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={onSearchKeyDown}
                placeholder="搜索邮箱或直接输入新邮箱后回车"
                className="h-8 w-full rounded-sm border border-input bg-background pl-7 pr-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                spellCheck={false}
                autoComplete="off"
              />
            </div>
          </div>

          {/* 选项列表 */}
          <ul
            role="listbox"
            className="max-h-72 overflow-auto p-1"
          >
            {loading && (
              <li className="px-2 py-1.5 text-xs text-muted-foreground">
                加载中…
              </li>
            )}
            {!loading && canCommitCustom && (
              <li
                role="option"
                aria-selected={activeIdx === -1}
                onMouseEnter={() => setActiveIdx(-1)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  void commitCustom();
                }}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm",
                  activeIdx === -1 && "bg-accent text-accent-foreground"
                )}
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate">{query}</span>
                  <span className="text-xs text-muted-foreground">
                    未注册邮箱，点击或回车使用
                  </span>
                </div>
              </li>
            )}
            {!loading && options.length === 0 && !canCommitCustom && (
              <li className="px-2 py-1.5 text-xs text-muted-foreground">
                {query.length === 0
                  ? "暂无注册用户"
                  : "没有匹配的用户"}
              </li>
            )}
            {!loading &&
              options.map((opt, idx) => {
                const selected = opt.email === value;
                return (
                  <li
                    key={opt.email}
                    role="option"
                    aria-selected={selected}
                    onMouseDown={(e) => {
                      // 阻止 mousedown 抢走搜索框焦点
                      e.preventDefault();
                      selectOption(opt);
                    }}
                    onMouseEnter={() => setActiveIdx(idx)}
                    className={cn(
                      "flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm",
                      idx === activeIdx && "bg-accent text-accent-foreground",
                      selected && "font-medium"
                    )}
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">{opt.email}</span>
                      {opt.name && (
                        <span className="truncate text-xs text-muted-foreground">
                          {opt.name}
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {opt.status !== "ACTIVE" && (
                        <span className="text-xs text-amber-600">
                          {opt.status === "DISABLED" ? "已禁用" : opt.status}
                        </span>
                      )}
                      {selected && (
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="h-3.5 w-3.5 text-primary"
                          aria-hidden="true"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>
                  </li>
                );
              })}
          </ul>
        </div>
      )}
    </div>
  );
}
