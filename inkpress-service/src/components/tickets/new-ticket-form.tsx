"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ImageUploader, type UploadedImage } from "./image-uploader";
import { TICKET_TYPE_LABELS } from "@/lib/tickets/constants";

export function NewTicketForm() {
  const router = useRouter();
  const [type, setType] = useState<string>("PAYMENT");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (subject.trim().length < 4) {
      setError("标题至少 4 字");
      return;
    }
    if (description.trim().length < 10) {
      setError("描述至少 10 字");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          subject: subject.trim(),
          description: description.trim(),
          attachments: images,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error?.message ?? "提交失败");
        setSubmitting(false);
        return;
      }
      router.push(`/dashboard/tickets/${json.data.id}`);
      router.refresh();
    } catch {
      setError("网络错误，请重试");
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className="mb-1.5 block text-sm font-medium">工单类型</label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
        >
          {Object.entries(TICKET_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium">标题</label>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={80}
          placeholder="简要描述问题（4-80 字）"
          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium">详细描述</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={5000}
          rows={6}
          placeholder="请详细描述你遇到的问题（至少 10 字）"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        />
        <p className="mt-1 text-right text-xs text-muted-foreground">
          {description.length}/5000
        </p>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium">截图（可选）</label>
        <ImageUploader value={images} onChange={setImages} />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-3">
        <Button type="submit" disabled={submitting}>
          {submitting ? "提交中…" : "提交工单"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={submitting}
        >
          取消
        </Button>
      </div>
    </form>
  );
}
