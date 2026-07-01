"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ARTICLE_PROFILE_OPTIONS,
  DEFAULT_ARTICLE_PROFILE,
} from "@/lib/ai/article-type-profile";

/**
 * 新建文章并跳转到编辑器。点击弹出文章类型选择（P3 profile），默认公众号观点/经验。
 * 可传入 spaceId 归属到空间。
 */
export function NewArticleButton({
  spaceId,
  label = "新建文章",
  variant = "default",
  size = "default",
}: {
  spaceId?: string;
  label?: string;
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "default" | "sm" | "lg" | "icon";
}) {
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [profileId, setProfileId] = useState(DEFAULT_ARTICLE_PROFILE);

  async function create() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/articles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "无标题文章",
          spaceId: spaceId ?? null,
          profileId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.article) {
        setError(data.error || "创建文章失败。");
        return;
      }
      window.location.href = `/editor/${data.article.id}`;
    } finally {
      setLoading(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant={variant} size={size} disabled={loading}>
          <Plus className="h-4 w-4" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="start">
        <div className="space-y-3">
          <div className="text-sm font-medium">选择文章类型</div>
          <Select value={profileId} onValueChange={setProfileId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ARTICLE_PROFILE_OPTIONS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <Button
            size="sm"
            className="w-full"
            disabled={loading}
            onClick={() => void create()}
          >
            {loading ? "创建中…" : "创建"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
