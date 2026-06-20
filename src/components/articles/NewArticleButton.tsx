"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/** 新建文章并跳转到编辑器 */
export function NewArticleButton() {
  const [loading, setLoading] = useState(false);
  return (
    <Button
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        try {
          const res = await fetch("/api/articles", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: "无标题文章" }),
          });
          const { article } = await res.json();
          window.location.href = `/editor/${article.id}`;
        } finally {
          setLoading(false);
        }
      }}
    >
      <Plus className="h-4 w-4" />
      新建文章
    </Button>
  );
}
