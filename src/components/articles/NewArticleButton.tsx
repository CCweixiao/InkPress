"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/** 新建文章并跳转到编辑器。可传入 spaceId 归属到空间。 */
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
  return (
    <Button
      variant={variant}
      size={size}
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        try {
          const res = await fetch("/api/articles", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: "无标题文章", spaceId: spaceId ?? null }),
          });
          const { article } = await res.json();
          window.location.href = `/editor/${article.id}`;
        } finally {
          setLoading(false);
        }
      }}
    >
      <Plus className="h-4 w-4" />
      {label}
    </Button>
  );
}
