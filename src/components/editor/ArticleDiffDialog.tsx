"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Columns2,
  FileDiff,
  FoldVertical,
  Loader2,
  Maximize2,
  Minimize2,
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
  summarizeRows,
  type ProposalDetail,
  type DiffRow,
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
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [activeChange, setActiveChange] = useState(0);
  const changeRefs = useRef<Array<HTMLDivElement | null>>([]);
  const rows = useMemo(
    () =>
      proposal
        ? foldRows(buildRows(proposal.baseMarkdown, proposal.markdown), fold)
        : [],
    [proposal, fold]
  );
  const rowSummary = useMemo(() => summarizeRows(rows), [rows]);
  const changeRows = useMemo(
    () =>
      rows
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => !["same", "fold"].includes(row.kind)),
    [rows]
  );
  const changeIndexByRowIndex = useMemo(() => {
    const map = new Map<number, number>();
    changeRows.forEach((item, index) => map.set(item.index, index));
    return map;
  }, [changeRows]);
  const canApply =
    ["pending", "applying", "error"].includes(proposal?.status ?? "") &&
    Boolean(onApply);
  const canReject = proposal?.status === "pending" && Boolean(onReject);
  const canDecide = canApply || canReject;
  const currentActiveChange = changeRows.length
    ? Math.min(activeChange, changeRows.length - 1)
    : 0;

  useEffect(() => {
    if (!open || window.innerWidth >= 768) return;
    const frame = window.requestAnimationFrame(() => setView("unified"));
    return () => window.cancelAnimationFrame(frame);
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
      if (key === "a" && onApply && canApply && !applying) {
        e.preventDefault();
        onApply();
      } else if (key === "r" && onReject && canReject && !applying) {
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
  }, [open, activeChange, changeRows, onApply, onReject, applying, canApply, canReject]);

  if (!proposal) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose={fullscreen}
        className={cn(
          "max-w-none overflow-hidden border-border bg-background p-0 gap-0 shadow-2xl",
          fullscreen
            ? "h-[100dvh] max-h-none w-[100vw] rounded-none"
            : "h-[96vh] w-[98vw] rounded-xl"
        )}
      >
        <DialogHeader
          className={cn(
            "border-b border-border bg-background px-5 py-3 pr-14",
            fullscreen && "sr-only"
          )}
        >
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="flex min-w-0 items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-blue-500/20 bg-blue-500/10 text-blue-600 dark:text-blue-300">
                <FileDiff className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="flex flex-wrap items-center gap-2 text-base font-semibold tracking-normal">
                  文章修改审查
                  <span className="rounded-md border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {proposal.stats.oldLines} → {proposal.stats.newLines} 行
                  </span>
                </DialogTitle>
                <DialogDescription
                  className={cn(
                    "mt-1 max-w-6xl text-xs leading-5 text-muted-foreground",
                    !summaryExpanded && "line-clamp-2"
                  )}
                >
                  {proposal.summary || "本次修改未提供摘要。"}
                </DialogDescription>
                {proposal.summary && proposal.summary.length > 96 ? (
                  <button
                    type="button"
                    onClick={() => setSummaryExpanded((value) => !value)}
                    className="mt-1 text-[11px] font-medium text-primary underline-offset-2 hover:underline"
                  >
                    {summaryExpanded ? "收起摘要" : "展开摘要"}
                  </button>
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-start gap-1.5 lg:justify-end">
              <DiffMetric label="新增" value={rowSummary.added} tone="add" />
              <DiffMetric label="删除" value={rowSummary.removed} tone="remove" />
              <DiffMetric label="修改" value={rowSummary.modified} tone="modify" />
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-background/95 px-4 py-2 backdrop-blur">
          <div className="flex items-center rounded-md border border-border bg-muted p-0.5">
            <Button
              size="sm"
              variant={view === "split" ? "default" : "ghost"}
              onClick={() => setView("split")}
              className="hidden h-7 rounded px-2.5 md:inline-flex"
            >
              <Columns2 className="h-3.5 w-3.5" />
              左右对比
            </Button>
            <Button
              size="sm"
              variant={view === "unified" ? "default" : "ghost"}
              onClick={() => setView("unified")}
              className="h-7 rounded px-2.5"
            >
              <Rows3 className="h-3.5 w-3.5" />
              统一视图
            </Button>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setFold((value) => !value)}
            className="h-8 rounded-md"
          >
            <FoldVertical className="h-3.5 w-3.5" />
            {fold ? "展开未修改" : "折叠未修改"}
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <span className="rounded-md border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
              {changeRows.length ? currentActiveChange + 1 : 0}/{changeRows.length}
            </span>
            <Button size="icon" variant="outline" className="h-8 w-8 rounded-md" onClick={() => navigate(-1)} title="上一处">
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="outline" className="h-8 w-8 rounded-md" onClick={() => navigate(1)} title="下一处">
              <ArrowDown className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              className="h-8 w-8 rounded-md"
              onClick={() => setFullscreen((value) => !value)}
              title={fullscreen ? "退出全屏" : "全屏审查"}
            >
              {fullscreen ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </Button>
            {canDecide && (
              <>
                <div className="mx-1 h-5 w-px bg-border" />
                {canApply && (
                  <Button size="sm" onClick={onApply} disabled={applying} title="应用修改" className="h-8 rounded-md">
                    {applying ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                    {proposal.status === "pending" ? "应用修改" : "重试同步"}
                  </Button>
                )}
                {canReject && (
                  <Button size="sm" variant="outline" onClick={onReject} disabled={applying} title="放弃" className="h-8 rounded-md">
                    <X className="h-3.5 w-3.5" />
                    放弃
                  </Button>
                )}
              </>
            )}
            {fullscreen ? (
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8 rounded-md"
                onClick={() => onOpenChange(false)}
                title="关闭"
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </div>

        {!fullscreen &&
          (proposal.baseTitle !== (proposal.title ?? proposal.baseTitle) ||
            proposal.baseDigest !== (proposal.digest ?? proposal.baseDigest)) && (
          <div className="grid gap-px border-b border-border bg-border text-xs md:grid-cols-2">
            <div className="bg-red-500/[0.06] p-3 dark:bg-red-500/10">
              <div className="mb-1 font-semibold text-red-700 dark:text-red-300">原标题 / 摘要</div>
              <div className="truncate font-medium text-foreground">{proposal.baseTitle || "（无标题）"}</div>
              <div className="mt-1 line-clamp-2 leading-5 text-muted-foreground">{proposal.baseDigest || "（无摘要）"}</div>
            </div>
            <div className="bg-emerald-500/[0.06] p-3 dark:bg-emerald-500/10">
              <div className="mb-1 font-semibold text-emerald-700 dark:text-emerald-300">新标题 / 摘要</div>
              <div className="truncate font-medium text-foreground">{proposal.title ?? proposal.baseTitle}</div>
              <div className="mt-1 line-clamp-2 leading-5 text-muted-foreground">{proposal.digest ?? proposal.baseDigest}</div>
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto bg-muted/30 text-foreground font-mono text-[12.5px] leading-5 dark:bg-neutral-950">
          {view === "split" ? (
            <div className="min-w-[900px]">
              <div className="sticky top-0 z-10 grid grid-cols-2 border-b border-border bg-background/95 shadow-sm backdrop-blur">
                <DiffPaneHeader tone="old" label="原内容" lines={proposal.stats.oldLines} />
                <DiffPaneHeader tone="new" label="新内容" lines={proposal.stats.newLines} />
              </div>
              {rows.map((row, index) => {
                const changeIndex = changeIndexByRowIndex.get(index) ?? -1;
                return (
                  <div
                    key={index}
                    ref={(element) => {
                      if (changeIndex >= 0) changeRefs.current[changeIndex] = element;
                    }}
                    className={cn(
                      "grid grid-cols-2 scroll-mt-24",
                      changeIndex === currentActiveChange &&
                        "relative z-[1] ring-1 ring-blue-500/70 ring-inset"
                    )}
                    onClick={() => {
                      if (changeIndex >= 0) setActiveChange(changeIndex);
                    }}
                  >
                    {row.kind === "fold" ? (
                      <FoldRow
                        foldedCount={row.foldedCount ?? 0}
                        onExpand={() => setFold(false)}
                      />
                    ) : (
                      <>
                        <SplitLine row={row} side="old" />
                        <SplitLine row={row} side="new" />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="min-w-[640px]">
              {rows.flatMap((row, index) => {
                const changeIndex = changeIndexByRowIndex.get(index) ?? -1;
                if (row.kind === "fold") {
                  return (
                    <FoldRow
                      key={index}
                      foldedCount={row.foldedCount ?? 0}
                      onExpand={() => setFold(false)}
                    />
                  );
                }
                const lines =
                  row.kind === "modified"
                    ? [
                        { side: "old" as const, sign: "-", number: row.oldNumber, text: row.oldText ?? "", tone: "bg-red-500/10 border-l-2 border-l-red-500 text-red-950 dark:bg-red-500/15 dark:text-red-50" },
                        { side: "new" as const, sign: "+", number: row.newNumber, text: row.newText ?? "", tone: "bg-emerald-500/10 border-l-2 border-l-emerald-500 text-emerald-950 dark:bg-emerald-500/15 dark:text-emerald-50" },
                      ]
                    : [
                        {
                          side: row.kind === "removed" ? ("old" as const) : ("new" as const),
                          sign: row.kind === "removed" ? "-" : row.kind === "added" ? "+" : " ",
                          number: row.oldNumber ?? row.newNumber,
                          text: row.oldText ?? row.newText ?? "",
                          tone: row.kind === "removed" ? "bg-red-500/10 border-l-2 border-l-red-500 text-red-950 dark:bg-red-500/15 dark:text-red-50" : row.kind === "added" ? "bg-emerald-500/10 border-l-2 border-l-emerald-500 text-emerald-950 dark:bg-emerald-500/15 dark:text-emerald-50" : "",
                        },
                      ];
                return lines.map((line, lineIndex) => (
                  <div
                    key={`${index}-${lineIndex}`}
                    ref={(element) => {
                      if (changeIndex >= 0 && lineIndex === 0) changeRefs.current[changeIndex] = element;
                    }}
                    className={cn(
                      "grid grid-cols-[34px_56px_1fr] scroll-mt-24 border-b border-border/60 bg-background",
                      line.tone,
                      changeIndex === currentActiveChange &&
                        lineIndex === 0 &&
                        "ring-1 ring-blue-500/70 ring-inset"
                    )}
                    onClick={() => {
                      if (changeIndex >= 0) setActiveChange(changeIndex);
                    }}
                  >
                    <span className="select-none border-r border-border/60 text-center text-muted-foreground">{line.sign}</span>
                    <span className="select-none border-r border-border/60 bg-muted/40 px-2 text-right text-muted-foreground">{line.number ?? ""}</span>
                    <pre className="whitespace-pre-wrap break-words px-3 py-0.5">
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
      </DialogContent>
    </Dialog>
  );
}

function DiffMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "add" | "remove" | "modify";
}) {
  const toneClass = {
    add: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    remove: "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300",
    modify: "border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  }[tone];

  return (
    <div className={cn("min-w-14 rounded-md border px-2.5 py-1.5 text-center", toneClass)}>
      <div className="text-[10px] font-medium opacity-80">{label}</div>
      <div className="mt-0.5 text-base font-semibold leading-none">{value}</div>
    </div>
  );
}

function DiffPaneHeader({
  label,
  lines,
  tone,
}: {
  label: string;
  lines: number;
  tone: "old" | "new";
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between bg-background px-4 py-2 text-xs font-medium",
        tone === "old"
          ? "border-r border-border text-red-700 dark:text-red-300"
          : "text-emerald-700 dark:text-emerald-300"
      )}
    >
      <span className="inline-flex items-center gap-2">
        <span
          className={cn(
            "h-2 w-2 rounded-full",
            tone === "old" ? "bg-red-400" : "bg-emerald-400"
          )}
        />
        {label}
      </span>
      <span className="text-[11px] font-normal text-muted-foreground">{lines} 行</span>
    </div>
  );
}

function FoldRow({
  foldedCount,
  onExpand,
}: {
  foldedCount: number;
  onExpand: () => void;
}) {
  return (
    <div className="col-span-2 flex items-center justify-center gap-3 border-y border-border bg-muted/50 py-1.5 text-muted-foreground">
      <span className="h-px w-16 bg-border" />
      <button
        type="button"
        onClick={onExpand}
        className="rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors hover:bg-background hover:text-foreground"
      >
        已折叠 {foldedCount} 行未修改内容
      </button>
      <span className="h-px w-16 bg-border" />
    </div>
  );
}

function SplitLine({
  row,
  side,
}: {
  row: DiffRow;
  side: "old" | "new";
}) {
  const isOld = side === "old";
  const text = isOld ? row.oldText : row.newText;
  const number = isOld ? row.oldNumber : row.newNumber;
  const changed = isOld
    ? row.kind === "removed" || row.kind === "modified"
    : row.kind === "added" || row.kind === "modified";

  return (
    <div
      className={cn(
        "grid grid-cols-[56px_1fr] border-b border-border/60 bg-background",
        isOld && "border-r border-border",
        changed &&
          (isOld
            ? "border-l-2 border-l-red-500 bg-red-500/10 text-red-950 dark:bg-red-500/15 dark:text-red-50"
            : "border-l-2 border-l-emerald-500 bg-emerald-500/10 text-emerald-950 dark:bg-emerald-500/15 dark:text-emerald-50")
      )}
    >
      <span className="select-none border-r border-border/60 bg-muted/40 px-2 text-right text-muted-foreground">
        {number ?? ""}
      </span>
      <pre className="whitespace-pre-wrap break-words px-3 py-0.5">
        {row.kind === "modified" ? (
          <InlineText
            oldText={row.oldText ?? ""}
            newText={row.newText ?? ""}
            side={side}
          />
        ) : (
          text
        )}
      </pre>
    </div>
  );
}
