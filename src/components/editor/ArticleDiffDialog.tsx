"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { diffChars, diffLines } from "diff";
import {
  ArrowDown,
  ArrowUp,
  Columns2,
  FoldVertical,
  Rows3,
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

export type ProposalDetail = {
  id: string;
  proposalKind?: "article" | "technical-document";
  targetId?: string;
  baseTitle: string;
  baseMarkdown: string;
  baseDigest: string;
  title: string | null;
  markdown: string;
  digest: string | null;
  summary: string;
  status: string;
  stats: { oldLines: number; newLines: number; changedLines: number };
};

type DiffRow = {
  oldNumber?: number;
  newNumber?: number;
  oldText?: string;
  newText?: string;
  kind: "same" | "added" | "removed" | "modified" | "fold";
  foldedCount?: number;
};

function splitLines(value: string) {
  const lines = value.split("\n");
  return lines.at(-1) === "" ? lines.slice(0, -1) : lines;
}

function buildRows(oldText: string, newText: string): DiffRow[] {
  const parts = diffLines(oldText, newText);
  const rows: DiffRow[] = [];
  let oldNumber = 1;
  let newNumber = 1;
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (part.removed && parts[index + 1]?.added) {
      const removed = splitLines(part.value);
      const added = splitLines(parts[index + 1].value);
      const length = Math.max(removed.length, added.length);
      for (let line = 0; line < length; line++) {
        rows.push({
          oldNumber: removed[line] !== undefined ? oldNumber++ : undefined,
          newNumber: added[line] !== undefined ? newNumber++ : undefined,
          oldText: removed[line],
          newText: added[line],
          kind:
            removed[line] !== undefined && added[line] !== undefined
              ? "modified"
              : removed[line] !== undefined
                ? "removed"
                : "added",
        });
      }
      index++;
      continue;
    }
    for (const line of splitLines(part.value)) {
      if (part.added) {
        rows.push({ newNumber: newNumber++, newText: line, kind: "added" });
      } else if (part.removed) {
        rows.push({ oldNumber: oldNumber++, oldText: line, kind: "removed" });
      } else {
        rows.push({
          oldNumber: oldNumber++,
          newNumber: newNumber++,
          oldText: line,
          newText: line,
          kind: "same",
        });
      }
    }
  }
  return rows;
}

function foldRows(rows: DiffRow[], enabled: boolean) {
  if (!enabled) return rows;
  const result: DiffRow[] = [];
  let index = 0;
  while (index < rows.length) {
    if (rows[index].kind !== "same") {
      result.push(rows[index++]);
      continue;
    }
    let end = index;
    while (end < rows.length && rows[end].kind === "same") end++;
    const run = rows.slice(index, end);
    if (run.length > 10) {
      result.push(
        ...run.slice(0, 3),
        { kind: "fold", foldedCount: run.length - 6 },
        ...run.slice(-3)
      );
    } else {
      result.push(...run);
    }
    index = end;
  }
  return result;
}

function InlineText({
  oldText,
  newText,
  side,
}: {
  oldText: string;
  newText: string;
  side: "old" | "new";
}) {
  return diffChars(oldText, newText).map((part, index) => {
    if (side === "old" && part.added) return null;
    if (side === "new" && part.removed) return null;
    const changed = side === "old" ? part.removed : part.added;
    return (
      <span
        key={index}
        className={cn(
          changed &&
            (side === "old"
              ? "bg-red-300/70 text-red-950"
              : "bg-emerald-300/70 text-emerald-950")
        )}
      >
        {part.value}
      </span>
    );
  });
}

export function ArticleDiffDialog({
  open,
  onOpenChange,
  proposal,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposal: ProposalDetail | null;
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
            {fold ? "展开未修改内容" : "折叠未修改内容"}
          </Button>
          <div className="ml-auto flex items-center gap-1">
            <span className="mr-1 text-xs text-muted-foreground">
              {changeRows.length ? activeChange + 1 : 0}/{changeRows.length}
            </span>
            <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => navigate(-1)}>
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => navigate(1)}>
              <ArrowDown className="h-4 w-4" />
            </Button>
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
                        <div className={cn("grid grid-cols-[48px_1fr] border-r border-slate-800", row.kind === "removed" || row.kind === "modified" ? "bg-red-950/45" : "")}>
                          <span className="select-none border-r border-slate-800 px-2 text-right text-slate-600">{row.oldNumber ?? ""}</span>
                          <pre className="whitespace-pre-wrap break-words px-3">
                            {row.kind === "modified" ? (
                              <InlineText oldText={row.oldText ?? ""} newText={row.newText ?? ""} side="old" />
                            ) : row.oldText}
                          </pre>
                        </div>
                        <div className={cn("grid grid-cols-[48px_1fr]", row.kind === "added" || row.kind === "modified" ? "bg-emerald-950/45" : "")}>
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
                        { side: "old" as const, sign: "-", number: row.oldNumber, text: row.oldText ?? "", tone: "bg-red-950/45" },
                        { side: "new" as const, sign: "+", number: row.newNumber, text: row.newText ?? "", tone: "bg-emerald-950/45" },
                      ]
                    : [
                        {
                          side: row.kind === "removed" ? ("old" as const) : ("new" as const),
                          sign: row.kind === "removed" ? "-" : row.kind === "added" ? "+" : " ",
                          number: row.oldNumber ?? row.newNumber,
                          text: row.oldText ?? row.newText ?? "",
                          tone: row.kind === "removed" ? "bg-red-950/45" : row.kind === "added" ? "bg-emerald-950/45" : "",
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
      </DialogContent>
    </Dialog>
  );
}
