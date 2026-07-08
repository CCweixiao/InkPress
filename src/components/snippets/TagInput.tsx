"use client";

import { useState, useRef, useMemo, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAX_TAGS, MAX_TAG_LEN } from "@/lib/snippets/batch-ops";

interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions: string[];
  placeholder?: string;
}

/**
 * 标签 chip 输入 + typeahead。
 * 提交键 Enter / , / Tab（trim + 去重 + ≤10 字 + 最多 5 个）；
 * Backspace 空输入删最后；Esc 清当前输入；↑↓ 导航 suggestion；
 * 失焦丢弃未提交文本（零误触）。
 */
export function TagInput({
  value,
  onChange,
  suggestions,
  placeholder,
}: TagInputProps) {
  const [text, setText] = useState("");
  const [highlight, setHighlight] = useState(-1);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = text.trim().toLowerCase();
    return suggestions
      .filter((s) => !value.includes(s))
      .filter((s) => (q ? s.toLowerCase().includes(q) : true))
      .slice(0, 8);
  }, [suggestions, value, text]);

  const addTag = (raw: string) => {
    const t = raw.trim().slice(0, MAX_TAG_LEN);
    if (!t) return;
    if (value.length >= MAX_TAGS) return;
    if (value.includes(t)) return;
    onChange([...value, t]);
  };

  const removeAt = (i: number) => {
    onChange(value.filter((_, idx) => idx !== i));
  };

  const commit = () => {
    const pick = highlight >= 0 ? filtered[highlight] : text;
    addTag(pick);
    setText("");
    setHighlight(-1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "," || e.key === "Tab") {
      if (text.trim() || highlight >= 0) {
        e.preventDefault();
        commit();
      }
    } else if (e.key === "Backspace") {
      if (text === "" && value.length > 0) {
        e.preventDefault();
        removeAt(value.length - 1);
      }
    } else if (e.key === "Escape") {
      setText("");
      setHighlight(-1);
    } else if (e.key === "ArrowDown") {
      if (filtered.length > 0) {
        e.preventDefault();
        setHighlight((h) => (h + 1) % filtered.length);
      }
    } else if (e.key === "ArrowUp") {
      if (filtered.length > 0) {
        e.preventDefault();
        setHighlight((h) => (h - 1 + filtered.length) % filtered.length);
      }
    }
  };

  return (
    <div className="relative">
      <div
        className="flex flex-wrap items-center gap-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm focus-within:ring-2 focus-within:ring-ring cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((t, i) => (
          <span
            key={t}
            className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-xs"
          >
            {t}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeAt(i);
              }}
              className="text-muted-foreground hover:text-foreground"
              aria-label={`移除标签 ${t}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => {
            setText(e.target.value.slice(0, MAX_TAG_LEN));
            setHighlight(-1);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setText("");
            setHighlight(-1);
          }}
          placeholder={value.length === 0 ? placeholder : ""}
          disabled={value.length >= MAX_TAGS}
          maxLength={MAX_TAG_LEN}
          className="flex-1 min-w-[80px] bg-transparent outline-none placeholder:text-muted-foreground/60"
        />
      </div>
      {focused && filtered.length > 0 && (
        <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-background shadow-md">
          {filtered.map((s, i) => (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault(); // 防 blur 先于 click
                addTag(s);
                setText("");
                setHighlight(-1);
                inputRef.current?.focus();
              }}
              className={cn(
                "block w-full px-3 py-1.5 text-left text-sm hover:bg-muted",
                i === highlight && "bg-muted"
              )}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
