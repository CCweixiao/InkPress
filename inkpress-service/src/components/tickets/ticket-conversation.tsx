"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ImageUploader, type UploadedImage } from "./image-uploader";
import { AttachmentGrid } from "./attachment-grid";
import { formatDate } from "@/lib/utils";
import type { SignedAttachment } from "@/lib/tickets/attach";

export interface ConversationMessage {
  id: string;
  authorRole: string;
  authorEmail?: string;
  content: string;
  createdAt: string;
  signedAttachments?: SignedAttachment[];
}

interface TicketConversationProps {
  ticketId: string;
  ticketStatus: string;
  messages: ConversationMessage[];
  /** 当前用户角色：USER 或 ADMIN */
  viewerRole: "USER" | "ADMIN";
}

export function TicketConversation({
  ticketId,
  ticketStatus,
  messages,
  viewerRole,
}: TicketConversationProps) {
  const [content, setContent] = useState("");
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isClosed = ticketStatus === "CLOSED";
  const isAdmin = viewerRole === "ADMIN";
  const apiBase = isAdmin ? "/api/admin" : "/api";

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!content.trim()) {
      setError("回复内容不能为空");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${apiBase}/tickets/${ticketId}/replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: content.trim(),
          attachments: images,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error?.message ?? "回复失败");
        setSubmitting(false);
        return;
      }
      setContent("");
      setImages([]);
      // 刷新页面以显示新回复
      window.location.reload();
    } catch {
      setError("网络错误，请重试");
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 消息流 */}
      <div className="space-y-4">
        {messages.map((msg) => {
          const isSelf =
            (isAdmin && msg.authorRole === "ADMIN") ||
            (!isAdmin && msg.authorRole === "USER");
          return (
            <div
              key={msg.id}
              className={`flex ${isSelf ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-lg border p-3 ${
                  isSelf ? "bg-primary/5" : "bg-card"
                }`}
              >
                <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium">
                    {msg.authorRole === "ADMIN" ? "管理员" : msg.authorEmail ?? "用户"}
                  </span>
                  <span>{formatDate(msg.createdAt)}</span>
                </div>
                <div className="whitespace-pre-wrap break-words text-sm">
                  {msg.content}
                </div>
                <AttachmentGrid raw={null} signed={msg.signedAttachments} />
              </div>
            </div>
          );
        })}
      </div>

      {/* 回复框 */}
      {isClosed && !isAdmin ? (
        <div className="rounded-lg border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
          工单已关闭，如需帮助请新建工单
        </div>
      ) : (
        <form
          onSubmit={handleReply}
          className="rounded-lg border bg-card p-4 space-y-3"
        >
          <label className="block text-sm font-medium">
            {isAdmin ? "管理员回复" : "追加回复"}
          </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={5000}
            rows={4}
            placeholder="输入回复内容…"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
          <ImageUploader value={images} onChange={setImages} />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end">
            <Button type="submit" disabled={submitting}>
              {submitting ? "发送中…" : "发送"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
