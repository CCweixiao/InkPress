"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Columns2,
  FoldVertical,
  Loader2,
  Rows3,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  buildRows,
  foldRows,
  InlineText,
  type ProposalDetail,
} from "./article-diff-utils";

// 保持向后兼容：ProposalDetail 已迁移到 article-diff-utils，此处 re-export
// 避免下游（如 WritingAssistant）的 import 断裂。
export type { ProposalDetail } from "./article-diff-utils";

export function ArticleDiffDialog({
  open,
  onOpenChange,
  proposal,
  onApply,
  onReject,
  applying = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposal: ProposalDetail | null;
  /** 在弹窗内就地应用/放弃（审查即操作），由 ProposalCard 传入。 */
  onApply?: () => void;
  onReject?: () => void;
  applying?: boolean;
}) {
  const [view, setView] = useState<"split" | "unified">("split");
  const [fold, setFold] = useState(true);
  const [activeChange, setActiveChange] = useState(0);
  const changeRefs = useRef<Array<HTMLDivElement | null>>([]);
  const rows = useMemo(
    () =>
      proposal
        ? foldRows(buildRows(proposal.baseMarkdown, proposal.markdown), fold)
        : [],
    [proposal, fold]
  );
  const changeRows = useMemo(
    () =>
      rows
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => !["same", "fold"].includes(row.kind)),
    [rows]
  );
  const canDecide =
    proposal?.status === "pending" && (!!onApply || !!onReject);

  useEffect(() => {
    if (open && window.innerWidth < 768) setView("unified");
  }, [open]);

  function navigate(direction: -1 | 1) {
    if (!changeRows.length) return;
    const next =
      (activeChange + direction + changeRows.length) % changeRows.length;
    setActiveChange(next);
    changeRefs.current[next]?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }

  // 键盘快捷键：↑↓ 跳改动、A 应用、R 放弃、F 折叠。仅在弹窗打开时挂载。
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === "ArrowUp") {
        e.preventDefault();
        navigate(-1);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        navigate(1);
        return;
      }
      const key = e.key.toLowerCase();
      if (key === "a" && onApply) {
        e.preventDefault();
        onApply();
      } else if (key === "r" && onReject) {
        e.preventDefault();
        onReject();
      } else if (key === "f") {
        e.preventDefault();
        setFold((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeChange, changeRows, onApply, onReject]);

  if (!proposal) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[96vh] w-[98vw] max-w-none overflow-hidden rounded-xl p-0 gap-0">
        <DialogHeader className="border-b px-5 py-4 pr-14">
          <DialogTitle className="flex flex-wrap items-center gap-3">
            <span>
              {proposal.proposalKind === "technical-document"
                ? "技术文档修改审查"
                : "文章修改审查"}
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              {proposal.stats.oldLines} → {proposal.stats.newLines} 行 ·{" "}
              {proposal.stats.changedLines} 行变化
            </span>
          </DialogTitle>
          <DialogDescription>{proposal.summary}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
          <Button
            size="sm"
            variant={view === "split" ? "default" : "outline"}
            onClick={() => setView("split")}
            className="hidden md:inline-flex"
          >
            <Columns2 className="h-4 w-4" />
            左右对比
          </Button>
          <Button
            size="sm"
            variant={view === "unified" ? "default" : "outline"}
            onClick={() => setView("unified")}
          >
            <Rows3 className="h-4 w-4" />
            统一视图
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setFold((value) => !value)}
          >
            <FoldVertical className="h-4 w-4" />
            {fold ? "展开未修改" : "折叠未修改"}
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <span className="mr-1 text-xs text-muted-foreground">
              {changeRows.length ? activeChange + 1 : 0}/{changeRows.length}
            </span>
            <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => navigate(-1)} title="上一处 (↑)">
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => navigate(1)} title="下一处 (↓)">
              <ArrowDown className="h-4 w-4" />
            </Button>
            {canDecide && (
              <>
                <div className="mx-1 h-5 w-px bg-border" />
                <Button size="sm" onClick={onApply} disabled={applying} title="应用 (A)">
                  {applying ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  应用
                  <span className="ml-1 opacity-60">A</span>
                </Button>
                <Button size="sm" variant="outline" onClick={onReject} disabled={applying} title="放弃 (R)">
                  <X className="h-3.5 w-3.5" />
                  放弃
                  <span className="ml-1 opacity-60">R</span>
                </Button>
              </>
            )}
          </div>
        </div>

        {(proposal.baseTitle !== (proposal.title ?? proposal.baseTitle) ||
          proposal.baseDigest !== (proposal.digest ?? proposal.baseDigest)) && (
          <div className="grid gap-px border-b bg-border text-xs md:grid-cols-2">
            <div className="bg-red-50 p-3">
              <div className="mb-1 font-medium text-red-700">原标题 / 摘要</div>
              <div>{proposal.baseTitle || "（无标题）"}</div>
              <div className="mt-1 text-muted-foreground">{proposal.baseDigest || "（无摘要）"}</div>
            </div>
            <div className="bg-emerald-50 p-3">
              <div className="mb-1 font-medium text-emerald-700">新标题 / 摘要</div>
              <div>{proposal.title ?? proposal.baseTitle}</div>
              <div className="mt-1 text-muted-foreground">{proposal.digest ?? proposal.baseDigest}</div>
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto bg-slate-950 text-slate-100 font-mono text-xs leading-5">
          {view === "split" ? (
            <div className="min-w-[900px]">
              <div className="sticky top-0 z-10 grid grid-cols-2 border-b border-slate-700 bg-slate-900">
                <div className="px-4 py-2 border-r border-slate-700">原内容</div>
                <div className="px-4 py-2">新内容</div>
              </div>
              {rows.map((row, index) => {
                const changeIndex = changeRows.findIndex((item) => item.index === index);
                return (
                  <div
                    key={index}
                    ref={(element) => {
                      if (changeIndex >= 0) changeRefs.current[changeIndex] = element;
                    }}
                    className="grid grid-cols-2"
                  >
                    {row.kind === "fold" ? (
                      <div className="col-span-2 border-y border-slate-800 bg-slate-900/80 py-1 text-center text-slate-500">
                        … 已折叠 {row.foldedCount} 行未修改内容 …
                      </div>
                    ) : (
                      <>
                        <div className={cn(
                          "grid grid-cols-[48px_1fr] border-r border-slate-800",
                          (row.kind === "removed" || row.kind === "modified") && "bg-red-950/40 border-l-2 border-l-red-500/60"
                        )}>
                          <span className="select-none border-r border-slate-800 px-2 text-right text-slate-600">{row.oldNumber ?? ""}</span>
                          <pre className="whitespace-pre-wrap break-words px-3">
                            {row.kind === "modified" ? (
                              <InlineText oldText={row.oldText ?? ""} newText={row.newText ?? ""} side="old" />
                            ) : row.oldText}
                          </pre>
                        </div>
                        <div className={cn(
                          "grid grid-cols-[48px_1fr]",
                          (row.kind === "added" || row.kind === "modified") && "bg-emerald-950/40 border-l-2 border-l-emerald-500/60"
                        )}>
                          <span className="select-none border-r border-slate-800 px-2 text-right text-slate-600">{row.newNumber ?? ""}</span>
                          <pre className="whitespace-pre-wrap break-words px-3">
                            {row.kind === "modified" ? (
                              <InlineText oldText={row.oldText ?? ""} newText={row.newText ?? ""} side="new" />
                            ) : row.newText}
                          </pre>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="min-w-[640px]">
              {rows.flatMap((row, index) => {
                const changeIndex = changeRows.findIndex((item) => item.index === index);
                if (row.kind === "fold") {
                  return (
                    <div key={index} className="border-y border-slate-800 bg-slate-900/80 py-1 text-center text-slate-500">
                      … 已折叠 {row.foldedCount} 行未修改内容 …
                    </div>
                  );
                }
                const lines =
                  row.kind === "modified"
                    ? [
                        { side: "old" as const, sign: "-", number: row.oldNumber, text: row.oldText ?? "", tone: "bg-red-950/40 border-l-2 border-l-red-500/60" },
                        { side: "new" as const, sign: "+", number: row.newNumber, text: row.newText ?? "", tone: "bg-emerald-950/40 border-l-2 border-l-emerald-500/60" },
                      ]
                    : [
                        {
                          side: row.kind === "removed" ? ("old" as const) : ("new" as const),
                          sign: row.kind === "removed" ? "-" : row.kind === "added" ? "+" : " ",
                          number: row.oldNumber ?? row.newNumber,
                          text: row.oldText ?? row.newText ?? "",
                          tone: row.kind === "removed" ? "bg-red-950/40 border-l-2 border-l-red-500/60" : row.kind === "added" ? "bg-emerald-950/40 border-l-2 border-l-emerald-500/60" : "",
                        },
                      ];
                return lines.map((line, lineIndex) => (
                  <div
                    key={`${index}-${lineIndex}`}
                    ref={(element) => {
                      if (changeIndex >= 0 && lineIndex === 0) changeRefs.current[changeIndex] = element;
                    }}
                    className={cn("grid grid-cols-[34px_48px_1fr]", line.tone)}
                  >
                    <span className="select-none text-center text-slate-500">{line.sign}</span>
                    <span className="select-none border-x border-slate-800 px-2 text-right text-slate-600">{line.number ?? ""}</span>
                    <pre className="whitespace-pre-wrap break-words px-3">
                      {row.kind === "modified" ? (
                        <InlineText oldText={row.oldText ?? ""} newText={row.newText ?? ""} side={line.side} />
                      ) : line.text}
                    </pre>
                  </div>
                ));
              })}
            </div>
          )}
        </div>

        {canDecide && (
          <div className="border-t px-4 py-1.5 text-center text-[10px] text-muted-foreground">
            快捷键 ↑↓ 跳改动 · A 应用 · R 放弃 · F 折叠
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
