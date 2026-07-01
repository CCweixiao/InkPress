"use client";

import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  ARTICLE_PROFILE_OPTIONS,
  getArticleProfile,
} from "@/lib/ai/article-type-profile";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * 当前文章类型 badge（P3 可见性）。对话区顶部显示 profile 名（如「技术深度」），
 * 点击展开描述 + 审稿 checklist。profileId 为空/未知回落默认（公众号观点/经验）。
 */
export function ArticleProfileBadge({
  profileId,
  onChange,
}: {
  profileId?: string | null;
  onChange?: (profileId: string) => void;
}) {
  const profile = getArticleProfile(profileId);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex cursor-pointer">
          <Badge variant="secondary">{profile.name}</Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64" align="start">
        <div className="text-xs">
          <div className="font-medium">{profile.name}</div>
          <div className="mt-1 text-muted-foreground">{profile.description}</div>
          {onChange && (
            <div className="mt-3">
              <Select value={profile.id} onValueChange={onChange}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ARTICLE_PROFILE_OPTIONS.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="mt-2 font-medium">审稿清单</div>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {profile.checklist.map((c) => (
              <li key={c}>· {c}</li>
            ))}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
}
