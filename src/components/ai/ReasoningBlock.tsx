"use client";

import { useEffect, useState } from "react";
import { BrainCircuit, Loader2 } from "lucide-react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";

/** 收起态虚化预览的最大字符数 */
const PREVIEW_CHARS = 80;

/**
 * 模型思考过程块（Codex 风格）。
 * - 默认收起；收起态灰色小字虚化显示前若干字预览。
 * - `state === "streaming"` 时自动展开，让用户看到实时思考。
 * - 用户手动收起后，即使仍在 streaming 也保持收起（尊重用户意愿）。
 */
export function ReasoningBlock({
  text,
  state,
}: {
  text: string;
  state?: string;
}) {
  const streaming = state === "streaming";
  const [open, setOpen] = useState(false);
  const [userToggled, setUserToggled] = useState(false);

  // 流式期间自动展开（除非用户已手动操作过）
  useEffect(() => {
    if (streaming && !userToggled) setOpen(true);
    if (!streaming && !userToggled) setOpen(false);
  }, [streaming, userToggled]);

  const preview =
    text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text;

  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => {
        setUserToggled(true);
        setOpen(next);
      }}
      className="rounded-md border border-violet-200 bg-violet-50/60 dark:border-violet-900 dark:bg-violet-950/40"
    >
      <CollapsibleTrigger className="px-2.5 py-2 text-[11px] text-violet-700 hover:bg-violet-100/50 rounded-md dark:text-violet-300 dark:hover:bg-violet-900/50">
        <BrainCircuit className="h-3.5 w-3.5" />
        <span className="font-medium">模型思考</span>
        {streaming && <Loader2 className="ml-auto h-3 w-3 animate-spin" />}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t border-violet-200 px-3 py-2 dark:border-violet-900">
          {open && (
            <div className="whitespace-pre-wrap break-words text-[11px] leading-5 text-violet-950 font-mono dark:text-violet-100">
              {text || (streaming ? "思考中…" : "")}
            </div>
          )}
        </div>
      </CollapsibleContent>
      {!open && preview && (
        <div className="px-3 pb-2 -mt-1 text-[11px] leading-5 text-violet-500/80 truncate dark:text-violet-400/80">
          {preview}
        </div>
      )}
    </Collapsible>
  );
}
