import { diffChars, diffLines } from "diff";
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

export type DiffRow = {
  oldNumber?: number;
  newNumber?: number;
  oldText?: string;
  newText?: string;
  kind: "same" | "added" | "removed" | "modified" | "fold";
  foldedCount?: number;
};

export function splitLines(value: string) {
  const lines = value.split("\n");
  return lines.at(-1) === "" ? lines.slice(0, -1) : lines;
}

export function buildRows(oldText: string, newText: string): DiffRow[] {
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

export function foldRows(rows: DiffRow[], enabled: boolean) {
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

/** 统计改动行数：供 ProposalCard 的 +新增 / -删除 可视化使用。 */
export function summarizeRows(rows: DiffRow[]) {
  let added = 0;
  let removed = 0;
  let modified = 0;
  for (const row of rows) {
    if (row.kind === "added") added++;
    else if (row.kind === "removed") removed++;
    else if (row.kind === "modified") modified++;
  }
  return { added, removed, modified };
}

export function InlineText({
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
              ? "bg-red-400/55 text-red-50"
              : "bg-emerald-400/55 text-emerald-50")
        )}
      >
        {part.value}
      </span>
    );
  });
}
