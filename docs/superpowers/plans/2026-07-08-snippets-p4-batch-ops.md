# 素材块 P4-22（批量操作）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:executing-plans（inline）按 task 执行。**本项目约束：不自动 commit，全部完成后用户发话再统一提交。** 各 task 不含 commit，仅以 vitest / typecheck / build / lint / 手测作 gate。

**Goal:** /snippets 选择模式下支持批量**加标签 / 移除标签 / 置顶·取消 / 删除**——单一 `POST /api/snippets/batch` 端点 + action 分发；客户端乐观 delta 更新 `snippets` 与侧栏标签计数。

**Architecture:** 纯逻辑 `batch-ops.ts`（`validateBatchBody`(zod discriminatedUnion) / `dedupeIds` / `parseTags` / `mergeTag` / `removeTag` / `resolvePinToggle` / `collectTagsUnion` / `diffTagSets` / `applyTagDeltas`，vitest）+ 端点（updateMany for delete/pin；`$transaction` read-modify-write for tag）+ `BatchTagPicker`（Popover）+ `SnippetsView` 工具栏接线 + `handleBatch` 乐观更新 + `useConfirm` 删除确认。

**Tech Stack:** Next 16.2.9 · Prisma 7（better-sqlite3）· zod · Radix Popover · vitest。

**Spec:** `docs/superpowers/specs/2026-07-08-snippets-p4-batch-ops-design.md`

## Global Constraints

- **不自动 commit**。
- **客户端安全**：`batch-ops.ts` 零 prisma 导入（仅 zod），client（SnippetsView / BatchTagPicker）+ server（route）共用安全；端点仅服务端。
- **SQLite 无原生 JSON update**：tag 增删 = `$transaction` 内逐条 `parseTags → mergeTag/removeTag → update tagsJson`（idempotent，不跳过未变行，少 bug）。
- **侧栏计数口径 = 全量**（服务端 `collectUniqueTags(allSnippets)`），客户端只持 40 条 → 批量后**不能**重算，必须按选中项 tag 变化做 **delta**（`diffTagSets` + `applyTagDeltas`）。
- **乐观更新纯净**：先纯计算 `nextSnippets` + `deltas`，再 `setState`——不在 updater 里搞副作用（避 StrictMode 双调）。
- **删除二次确认**用 `useConfirm()`（`@/components/ui/confirm-dialog`，destructive），不用 `window.confirm`。
- **关键字 verbatim**：`MAX_TAGS=8` / `MAX_TAG_LEN=20`（与 `TagInput` 同源，本地声明）；ids 上限 `50`；软删 `trashed:true, trashedAt:new Date()`；action 枚举 `"delete"|"pin"|"addTag"|"removeTag"`。
- **TDD 边界 = 纯逻辑**：`batch-ops.ts` 全部进 vitest；端点 / `BatchTagPicker` / `SnippetsView` 走 typecheck + build + lint + 手测。

## Pre-flight

- 分支：从当前 `feat/snippets-p4-export-draft` 开 stacked 子分支 `feat/snippets-p4-batch-ops`。

---

### Task 1: 纯逻辑 `batch-ops.ts` + vitest

**Files:**
- Create: `src/lib/snippets/batch-ops.ts`
- Test: `tests/unit/snippet-batch-ops.test.ts`

**Interfaces:**
- Consumes: `zod`
- Produces:
  ```ts
  export const MAX_TAGS = 8;
  export const MAX_TAG_LEN = 20;
  export type BatchAction = "delete" | "pin" | "addTag" | "removeTag";
  export type ParsedBatchBody =
    | { ids: string[]; action: "delete" }
    | { ids: string[]; action: "pin"; pinned: boolean }
    | { ids: string[]; action: "addTag"; tag: string }
    | { ids: string[]; action: "removeTag"; tag: string };
  export type TagCount = { name: string; count: number; color: string | null };

  export function validateBatchBody(body: unknown): { ok: true; data: ParsedBatchBody } | { ok: false; error: string };
  export function dedupeIds(ids: string[]): string[];
  export function parseTags(json: string | null | undefined): string[];
  export function mergeTag(existing: string[], tag: string): string[];
  export function removeTag(existing: string[], tag: string): string[];
  export function resolvePinToggle(selected: { pinned: boolean }[]): { target: boolean; label: "置顶" | "取消置顶" };
  export function collectTagsUnion(snippets: { tagsJson: string }[]): string[];
  export function diffTagSets(before: string[], after: string[]): { added: string[]; removed: string[] };
  export function applyTagDeltas(tags: TagCount[], deltas: Map<string, number>): TagCount[];
  ```

- [ ] **Step 1: 写失败测试** `tests/unit/snippet-batch-ops.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  MAX_TAGS,
  validateBatchBody,
  dedupeIds,
  parseTags,
  mergeTag,
  removeTag,
  resolvePinToggle,
  collectTagsUnion,
  diffTagSets,
  applyTagDeltas,
} from "@/lib/snippets/batch-ops";

describe("dedupeIds", () => {
  it("保序去重", () => {
    expect(dedupeIds(["b", "a", "b", "c", "a"])).toEqual(["b", "a", "c"]);
  });
  it("空数组", () => {
    expect(dedupeIds([])).toEqual([]);
  });
});

describe("parseTags", () => {
  it("合法数组", () => {
    expect(parseTags('["a","b"]')).toEqual(["a", "b"]);
  });
  it("空串 → []", () => {
    expect(parseTags("")).toEqual([]);
  });
  it("null/undefined → []", () => {
    expect(parseTags(null)).toEqual([]);
    expect(parseTags(undefined)).toEqual([]);
  });
  it("非法 JSON → []", () => {
    expect(parseTags("not json")).toEqual([]);
  });
  it("非数组 JSON → []", () => {
    expect(parseTags('{"a":1}')).toEqual([]);
  });
  it("过滤非字符串项", () => {
    expect(parseTags('["a",1,true,"b"]')).toEqual(["a", "b"]);
  });
});

describe("mergeTag", () => {
  it("新增", () => {
    expect(mergeTag(["a"], "b")).toEqual(["a", "b"]);
  });
  it("已存在原样返回", () => {
    expect(mergeTag(["a", "b"], "a")).toEqual(["a", "b"]);
  });
  it("达上限原样返回", () => {
    const full = Array.from({ length: MAX_TAGS }, (_, i) => `t${i}`);
    expect(mergeTag(full, "new")).toEqual(full);
  });
  it("空白 tag 原样返回", () => {
    expect(mergeTag(["a"], "   ")).toEqual(["a"]);
  });
  it("trim 后追加", () => {
    expect(mergeTag(["a"], "  b  ")).toEqual(["a", "b"]);
  });
});

describe("removeTag", () => {
  it("移除存在项", () => {
    expect(removeTag(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });
  it("不存在原样返回", () => {
    expect(removeTag(["a", "b"], "x")).toEqual(["a", "b"]);
  });
});

describe("resolvePinToggle", () => {
  it("全 pinned → 取消置顶", () => {
    expect(resolvePinToggle([{ pinned: true }, { pinned: true }])).toEqual({ target: false, label: "取消置顶" });
  });
  it("部分 pinned → 置顶", () => {
    expect(resolvePinToggle([{ pinned: true }, { pinned: false }])).toEqual({ target: true, label: "置顶" });
  });
  it("全无 pinned → 置顶", () => {
    expect(resolvePinToggle([{ pinned: false }])).toEqual({ target: true, label: "置顶" });
  });
  it("空数组 → 置顶", () => {
    expect(resolvePinToggle([])).toEqual({ target: true, label: "置顶" });
  });
});

describe("collectTagsUnion", () => {
  it("多 snippet 标签并集去重保序", () => {
    expect(
      collectTagsUnion([
        { tagsJson: '["a","b"]' },
        { tagsJson: '["b","c"]' },
        { tagsJson: "[]" },
      ])
    ).toEqual(["a", "b", "c"]);
  });
  it("忽略非法 tagsJson", () => {
    expect(collectTagsUnion([{ tagsJson: "bad" }, { tagsJson: '["x"]' }])).toEqual(["x"]);
  });
});

describe("diffTagSets", () => {
  it("纯增", () => {
    expect(diffTagSets(["a"], ["a", "b"])).toEqual({ added: ["b"], removed: [] });
  });
  it("纯减", () => {
    expect(diffTagSets(["a", "b"], ["a"])).toEqual({ added: [], removed: ["b"] });
  });
  it("增减并存", () => {
    expect(diffTagSets(["a", "b"], ["b", "c"])).toEqual({ added: ["c"], removed: ["a"] });
  });
  it("无变化", () => {
    expect(diffTagSets(["a"], ["a"])).toEqual({ added: [], removed: [] });
  });
});

describe("applyTagDeltas", () => {
  const base = [
    { name: "a", count: 3, color: null },
    { name: "b", count: 1, color: "red" },
  ];
  it("正 delta 新增标签", () => {
    const out = applyTagDeltas(base, new Map([["c", 2]]));
    expect(out.find((t) => t.name === "c")).toEqual({ name: "c", count: 2, color: null });
  });
  it("负 delta 归零剔除", () => {
    const out = applyTagDeltas(base, new Map([["b", -1]]));
    expect(out.find((t) => t.name === "b")).toBeUndefined();
  });
  it("已有标签增减 count", () => {
    const out = applyTagDeltas(base, new Map([["a", 2]]));
    expect(out.find((t) => t.name === "a")?.count).toBe(5);
  });
  it("排序：count 降序 + name 升序", () => {
    const out = applyTagDeltas(
      [
        { name: "a", count: 1, color: null },
        { name: "b", count: 1, color: null },
      ],
      new Map([["a", 2]])
    );
    expect(out.map((t) => t.name)).toEqual(["a", "b"]);
  });
  it("零/负 delta 不产生新标签", () => {
    expect(applyTagDeltas(base, new Map([["new", -1]]))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "a" }),
        expect.objectContaining({ name: "b" }),
      ])
    );
  });
});

describe("validateBatchBody", () => {
  it("delete 合法", () => {
    const r = validateBatchBody({ ids: ["1", "2"], action: "delete" });
    expect(r.ok).toBe(true);
  });
  it("pin 需 pinned", () => {
    expect(validateBatchBody({ ids: ["1"], action: "pin", pinned: true }).ok).toBe(true);
    expect(validateBatchBody({ ids: ["1"], action: "pin" }).ok).toBe(false);
  });
  it("addTag 需 tag 1-20 字（trim 后）", () => {
    expect(validateBatchBody({ ids: ["1"], action: "addTag", tag: "新标签" }).ok).toBe(true);
    expect(validateBatchBody({ ids: ["1"], action: "addTag", tag: "   " }).ok).toBe(false);
    expect(validateBatchBody({ ids: ["1"], action: "addTag", tag: "一".repeat(21) }).ok).toBe(false);
  });
  it("ids 上限 50", () => {
    const ids = Array.from({ length: 51 }, (_, i) => `${i}`);
    expect(validateBatchBody({ ids, action: "delete" }).ok).toBe(false);
  });
  it("ids 空数组非法", () => {
    expect(validateBatchBody({ ids: [], action: "delete" }).ok).toBe(false);
  });
  it("action 非法", () => {
    expect(validateBatchBody({ ids: ["1"], action: "weird" }).ok).toBe(false);
  });
  it("tag 经 trim 后回填（addTag 返回 trimmed tag）", () => {
    const r = validateBatchBody({ ids: ["1"], action: "addTag", tag: "  x  " });
    expect(r.ok && r.data.action === "addTag" && r.data.tag).toBe(true);
    if (r.ok && r.data.action === "addTag") expect(r.data.tag).toBe("x");
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm vitest run tests/unit/snippet-batch-ops.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/lib/snippets/batch-ops.ts`**

```ts
import { z } from "zod";

/** 与 src/components/snippets/TagInput 同源，本地声明避免 client 取常量导入带状态组件。 */
export const MAX_TAGS = 8;
export const MAX_TAG_LEN = 20;

export type BatchAction = "delete" | "pin" | "addTag" | "removeTag";

const idsSchema = z.array(z.string().min(1)).min(1).max(50);
const tagSchema = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(1).max(MAX_TAG_LEN));

const batchSchema = z.discriminatedUnion("action", [
  z.object({ ids: idsSchema, action: z.literal("delete") }),
  z.object({ ids: idsSchema, action: z.literal("pin"), pinned: z.boolean() }),
  z.object({ ids: idsSchema, action: z.literal("addTag"), tag: tagSchema }),
  z.object({ ids: idsSchema, action: z.literal("removeTag"), tag: tagSchema }),
]);

export type ParsedBatchBody = z.infer<typeof batchSchema>;

export type TagCount = { name: string; count: number; color: string | null };

/** 校验批量操作入参；tag 自动 trim。 */
export function validateBatchBody(
  body: unknown
): { ok: true; data: ParsedBatchBody } | { ok: false; error: string } {
  const r = batchSchema.safeParse(body);
  if (r.success) return { ok: true, data: r.data };
  return { ok: false, error: "参数无效" };
}

/** 保序去重。 */
export function dedupeIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

/** 解析 tagsJson 为 string[]；非法/空/非数组一律返 []。 */
export function parseTags(json: string | null | undefined): string[] {
  try {
    const v = JSON.parse(json || "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** 追加 tag（去重 + ≤MAX_TAGS + trim）；已达上限或已存在或空白原样返回。 */
export function mergeTag(existing: string[], tag: string): string[] {
  const t = tag.trim();
  if (!t) return existing;
  if (existing.includes(t)) return existing;
  if (existing.length >= MAX_TAGS) return existing;
  return [...existing, t];
}

/** 移除 tag（不存在原样返回）。 */
export function removeTag(existing: string[], tag: string): string[] {
  const t = tag.trim();
  return existing.filter((x) => x !== t);
}

/** 选中项「全 pinned」→ 取消置顶（target:false）；否则置顶（target:true）。 */
export function resolvePinToggle(selected: {
  pinned: boolean;
}[]): { target: boolean; label: "置顶" | "取消置顶" } {
  if (selected.length > 0 && selected.every((s) => s.pinned)) {
    return { target: false, label: "取消置顶" };
  }
  return { target: true, label: "置顶" };
}

/** 选中项所有标签的并集（去重保序）——移除 picker 候选来源。 */
export function collectTagsUnion(snippets: { tagsJson: string }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of snippets) {
    for (const t of parseTags(s.tagsJson)) {
      if (!seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    }
  }
  return out;
}

/** before → after 的标签增删 diff。 */
export function diffTagSets(
  before: string[],
  after: string[]
): { added: string[]; removed: string[] } {
  const bs = new Set(before);
  const as = new Set(after);
  return {
    added: after.filter((t) => !bs.has(t)),
    removed: before.filter((t) => !as.has(t)),
  };
}

/** 按 deltas 增减侧栏计数；count≤0 剔除；正 delta 对新标签新建；count 降序 + name 升序。 */
export function applyTagDeltas(tags: TagCount[], deltas: Map<string, number>): TagCount[] {
  const map = new Map(tags.map((t) => [t.name, { ...t }]));
  for (const [name, d] of deltas) {
    const cur = map.get(name);
    if (cur) {
      cur.count += d;
    } else if (d > 0) {
      map.set(name, { name, count: d, color: null });
    }
  }
  return Array.from(map.values())
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm vitest run tests/unit/snippet-batch-ops.test.ts`
Expected: PASS（全绿）。

- [ ] **Step 5: typecheck**

Run: `pnpm typecheck`
Expected: 0 error。

---

### Task 2: 批量端点 `POST /api/snippets/batch`

**Files:**
- Create: `src/app/api/snippets/batch/route.ts`

**Interfaces:**
- Consumes: `validateBatchBody` / `dedupeIds` / `parseTags` / `mergeTag` / `removeTag`（Task 1）；`prisma`（`@/lib/db`）；`withApiLog` / `logMutation`（`@/lib/api-log`）

- [ ] **Step 1: 写端点**

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withApiLog, logMutation } from "@/lib/api-log";
import {
  validateBatchBody,
  dedupeIds,
  parseTags,
  mergeTag,
  removeTag,
} from "@/lib/snippets/batch-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 选择模式批量操作：delete（软删）/ pin / addTag / removeTag。
 * - delete / pin：updateMany 一次成型。
 * - addTag / removeTag：SQLite 无原生 JSON update → $transaction 逐条 read-modify-write。
 */
export const POST = withApiLog(
  "POST /api/snippets/batch",
  async (req: NextRequest) => {
    const parsed = validateBatchBody(await req.json().catch(() => ({})));
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const { action } = parsed.data;
    const ids = dedupeIds(parsed.data.ids);

    // 只操作实存且未删除的
    const found = await prisma.snippet.findMany({
      where: { id: { in: ids }, trashed: false },
    });
    if (found.length === 0) {
      return NextResponse.json({ error: "没有可操作的素材" }, { status: 400 });
    }
    const foundIds = found.map((s) => s.id);

    try {
      if (action === "delete") {
        const now = new Date();
        await prisma.snippet.updateMany({
          where: { id: { in: foundIds } },
          data: { trashed: true, trashedAt: now },
        });
      } else if (action === "pin") {
        await prisma.snippet.updateMany({
          where: { id: { in: foundIds } },
          data: { pinned: parsed.data.pinned },
        });
      } else {
        // addTag / removeTag：逐条 read-modify-write，事务保原子
        const tag = parsed.data.tag;
        await prisma.$transaction(async (tx) => {
          for (const row of found) {
            const before = parseTags(row.tagsJson);
            const after =
              action === "addTag" ? mergeTag(before, tag) : removeTag(before, tag);
            await tx.snippet.update({
              where: { id: row.id },
              data: { tagsJson: JSON.stringify(after) },
            });
          }
        });
      }
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "批量操作失败" },
        { status: 500 }
      );
    }

    logMutation("snippet", action, {
      count: found.length,
      tag: action === "addTag" || action === "removeTag" ? parsed.data.tag : undefined,
    });

    return NextResponse.json({ ok: true, affected: found.length });
  }
);
```

- [ ] **Step 2: typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: 0 error / ✓ Compiled。

---

### Task 3: `BatchTagPicker` 组件（Popover）

**Files:**
- Create: `src/components/snippets/BatchTagPicker.tsx`

**Interfaces:**
- Consumes: `Popover` / `PopoverTrigger` / `PopoverContent`（`@/components/ui/popover`）；`MAX_TAG_LEN`（Task 1，仅 add 模式新建长度上限）
- Produces: 受控 tag picker，`onPick(tag)` 后由调用方关 popover（内部也关）

- [ ] **Step 1: 写组件**

```tsx
"use client";

import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { MAX_TAG_LEN } from "@/lib/snippets/batch-ops";

interface BatchTagPickerProps {
  /** add：候选用全量已有标签；remove：候选用选中项标签 union（外部算好传入）。 */
  mode: "add" | "remove";
  candidates: string[];
  label: string;
  disabled?: boolean;
  onPick: (tag: string) => void;
}

/**
 * 选择模式下的 tag picker：过滤输入 + 候选列表 +（add 模式）新建行。
 * 单次选一个标签 → onPick → 关闭。加/移除共用。
 */
export function BatchTagPicker({
  mode,
  candidates,
  label,
  disabled,
  onPick,
}: BatchTagPickerProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const query = q.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      candidates.filter((t) => (query ? t.toLowerCase().includes(query) : true)),
    [candidates, query]
  );
  const exactExists = candidates.some((t) => t.toLowerCase() === query);
  const canCreate =
    mode === "add" && query.length > 0 && query.length <= MAX_TAG_LEN && !exactExists;

  const pick = (tag: string) => {
    onPick(tag);
    setOpen(false);
    setQ("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="text-xs rounded-md border border-transparent px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={mode === "add" ? "搜索或新建标签" : "搜索标签"}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
          />
        </div>
        <div className="mt-1 max-h-52 overflow-auto">
          {filtered.map((t) => (
            <button
              key={t}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault(); // 防 blur 先于 click
                pick(t);
              }}
              className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
            >
              #{t}
            </button>
          ))}
          {canCreate && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(q.trim());
              }}
              className="flex w-full items-center gap-1 rounded px-2 py-1.5 text-left text-sm text-primary hover:bg-muted"
            >
              <Plus className="h-3.5 w-3.5" />
              新建「{q.trim()}」
            </button>
          )}
          {filtered.length === 0 && !canCreate && (
            <p className="px-2 py-2 text-xs text-muted-foreground">
              {mode === "remove" ? "选中项没有标签" : "无匹配标签"}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: 0 error / ✓ Compiled。

---

### Task 4: `SnippetsView` 工具栏接线 + `handleBatch` 乐观更新

**Files:**
- Modify: `src/components/snippets/SnippetsView.tsx`

**Interfaces:**
- Consumes: Task 1 全部纯函数；Task 3 `BatchTagPicker`；`useConfirm`（`@/components/ui/confirm-dialog`）；现有 `snippets` / `tags` state + `selectMode` / `selectedIds` / `exitSelect`

- [ ] **Step 1: 加 import**

文件顶部 import 区追加：
```ts
import { Trash2, Pin } from "lucide-react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { BatchTagPicker } from "./BatchTagPicker";
import {
  resolvePinToggle,
  collectTagsUnion,
  parseTags,
  mergeTag,
  removeTag,
  diffTagSets,
  applyTagDeltas,
  type BatchAction,
} from "@/lib/snippets/batch-ops";
```

- [ ] **Step 2: 加 state + confirm hook**

组件内（紧挨现有 `selectMode` / `selectedIds` / `exportMsg` state 处）追加：
```ts
  const [batchMsg, setBatchMsg] = useState<string | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();
```

- [ ] **Step 3: 派生选中项 + pinToggle + remove 候选**

在 `exitSelect` 定义之后、`handleExport` 之前（或任意渲染前位置）加：
```ts
  const selectedSet = new Set(selectedIds);
  const selectedSnippets = snippets.filter((s) => selectedSet.has(s.id));
  const pinToggle = resolvePinToggle(
    selectedSnippets.map((s) => ({ pinned: !!s.pinned }))
  );
  const removeCandidates = collectTagsUnion(selectedSnippets);
```

- [ ] **Step 4: 写 `handleBatch`**

接在 `exitSelect` 之后：
```ts
  const handleBatch = async (
    action: BatchAction,
    opts?: { pinned?: boolean; tag?: string }
  ) => {
    if (selectedIds.length === 0) return;

    // 删除二次确认
    if (action === "delete") {
      const ok = await confirm({
        title: `删除选中的 ${selectedIds.length} 条素材？`,
        description: "移入回收站，可找回。",
        variant: "destructive",
        confirmText: "删除",
      });
      if (!ok) return;
    }

    // 纯计算乐观结果（不在 setState updater 里搞副作用）
    const target = opts?.pinned;
    const tag = opts?.tag ?? "";
    const deltas = new Map<string, number>();
    let nextSnippets = snippets;
    let nextTags = tags;

    if (action === "delete") {
      for (const s of selectedSnippets) {
        for (const t of parseTags(s.tagsJson)) {
          deltas.set(t, (deltas.get(t) ?? 0) - 1);
        }
      }
      nextSnippets = snippets.filter((s) => !selectedSet.has(s.id));
      nextTags = applyTagDeltas(tags, deltas);
    } else if (action === "pin" && typeof target === "boolean") {
      nextSnippets = snippets.map((s) =>
        selectedSet.has(s.id) ? { ...s, pinned: target } : s
      );
    } else if (action === "addTag" || action === "removeTag") {
      nextSnippets = snippets.map((s) => {
        if (!selectedSet.has(s.id)) return s;
        const before = parseTags(s.tagsJson);
        const after =
          action === "addTag" ? mergeTag(before, tag) : removeTag(before, tag);
        const { added, removed } = diffTagSets(before, after);
        for (const t of added) deltas.set(t, (deltas.get(t) ?? 0) + 1);
        for (const t of removed) deltas.set(t, (deltas.get(t) ?? 0) - 1);
        return { ...s, tagsJson: JSON.stringify(after) };
      });
      nextTags = applyTagDeltas(tags, deltas);
    }

    // 乐观落地 + 退出选择
    setSnippets(nextSnippets);
    if (nextTags !== tags) setTags(nextTags);
    exitSelect();
    setBatchMsg(null);

    // 发请求
    const body: Record<string, unknown> = { ids: selectedIds, action };
    if (action === "pin") body.pinned = target;
    if (action === "addTag" || action === "removeTag") body.tag = tag;

    try {
      const res = await fetch("/api/snippets/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "操作失败");
    } catch (e) {
      // 回滚
      setSnippets(snippets);
      setTags(tags);
      setBatchMsg(e instanceof Error ? e.message : "操作失败");
      window.setTimeout(() => setBatchMsg(null), 3000);
    }
  };
```

> 注：回滚用闭包里的 `snippets` / `tags`（调用时的快照）——它们是本次渲染的 state，等价于显式 snapshot。

- [ ] **Step 5: 工具栏 UI 扩展**

把现有 selectMode 分支（「已选 N · 导出为草稿 · 取消」`<div>`）替换为带 4 操作入口的版本：
```tsx
        {selectMode ? (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-muted-foreground">
              已选 {selectedIds.length} · 共 {totalCount} 条
            </span>
            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={selectedIds.length === 0}
              className="text-xs rounded-md bg-primary px-3 py-1 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              导出为草稿
            </button>
            <BatchTagPicker
              mode="add"
              candidates={tags.map((t) => t.name)}
              label="加标签"
              disabled={selectedIds.length === 0}
              onPick={(tag) => void handleBatch("addTag", { tag })}
            />
            <BatchTagPicker
              mode="remove"
              candidates={removeCandidates}
              label="移除标签"
              disabled={selectedIds.length === 0}
              onPick={(tag) => void handleBatch("removeTag", { tag })}
            />
            <button
              type="button"
              onClick={() => void handleBatch("pin", { pinned: pinToggle.target })}
              disabled={selectedIds.length === 0}
              className="text-xs rounded-md border border-transparent px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 inline-flex items-center gap-1"
            >
              <Pin className="h-3 w-3" />
              {pinToggle.label}
            </button>
            <button
              type="button"
              onClick={() => void handleBatch("delete")}
              disabled={selectedIds.length === 0}
              className="text-xs rounded-md border border-transparent px-2 py-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50 inline-flex items-center gap-1"
            >
              <Trash2 className="h-3 w-3" />
              删除
            </button>
            <button
              type="button"
              onClick={exitSelect}
              className="text-xs text-muted-foreground hover:text-foreground px-2"
            >
              取消
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3 ml-auto">
            <span className="text-xs text-muted-foreground">
              共 {totalCount} 条灵感
            </span>
            <button
              type="button"
              onClick={() => setSelectMode(true)}
              className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-muted"
            >
              选择
            </button>
          </div>
        )}
```

- [ ] **Step 6: 渲染 `batchMsg` + confirm dialog**

在列表区上方（现有 `exportMsg` `<p>` 旁）加：
```tsx
          {batchMsg && (
            <p className="text-xs text-destructive mb-2">{batchMsg}</p>
          )}
```
在返回的根 `<div>` 末尾（闭合前）渲染 confirm 弹窗：
```tsx
      {confirmDialog}
```

- [ ] **Step 7: typecheck + build + lint**

Run: `pnpm typecheck && pnpm build && pnpm lint`
Expected: 0 error / ✓ Compiled / lint 0 errors。

- [ ] **Step 8: 手测**

1. /snippets「选择」→ 选 3 张（不同 kind / 不同 tag）。
2. **加标签**：「加标签」→ 输入「foo」→ 列表无 →「+ 新建「foo」」→ 点 → 3 张都加 `#foo`；侧栏 `foo` 计数 +3（新建为 3）。
3. **移除标签**：「移除标签」→ 候选只含选中项已有标签 → 点一个 → 从选中项移除；侧栏计数 −。
4. **置顶**：选中含已置顶+未置顶 → 按钮显「置顶」→ 全 pinned=true；再选全 pinned → 显「取消置顶」→ 全 false。
5. **删除**：「删除」→ useConfirm destructive 弹窗 → 确认 → 卡片消失、计数 −；回收站可见。
6. 每次操作后自动退出选择模式，工具栏恢复「共 N 条 · 选择」。
7. 断网重试：操作失败 → 顶部 inline 红字，数据回滚（卡片/计数复原）。
8. 0 选中：「加标签/移除/置顶/删除/导出」全 disabled，「取消」可点。

---

## Self-Review

**1. Spec 覆盖：**
- 4 操作（delete/pin/addTag/removeTag）→ T2 端点 + T4 UI ✓
- 单一端点 + action 分发 → T2 ✓
- 置顶 toggle 语义（全 pinned→取消）→ `resolvePinToggle` T1 + T4 ✓
- tag picker（add 全量+新建 / remove union）→ T3 + T4 ✓
- 删除 useConfirm → T4 ✓
- 乐观 delta 更新（侧栏全量口径）→ `diffTagSets` + `applyTagDeltas` T1 + T4 ✓
- 客户端安全（batch-ops 零 prisma）→ T1 ✓

**2. Placeholder 扫描：** 无 TBD；MAX_TAGS/MAX_TAG_LEN/ids 上限 50/软删字段/action 枚举 verbatim。

**3. 类型一致性：**
- `ParsedBatchBody` 为 discriminated union，T2 里 `parsed.data.tag` / `parsed.data.pinned` 在对应 action 分支可窄化（TS 对 `z.discriminatedUnion` 推导为 union，访问非公字段需先 narrow——T2 实现里 `parsed.data.pinned` 在 `action === "pin"` 分支后访问，TS 会收窄；若 typecheck 报错，把 `const { action } = parsed.data;` 改为在分支内 `if (parsed.data.action === "pin")` 形式收窄。实施时按 typecheck 调）。
- `TagCount` 与 SnippetsView 的 `TagEntry` 结构同形（`{name,count,color}`）。
- `BatchAction` 在 T4 import 复用。

**4. 客户端安全：** `batch-ops.ts` 仅 import zod；`BatchTagPicker` import `batch-ops` 的 `MAX_TAG_LEN`（纯常量）；`SnippetsView` import 纯函数 + 常量。零 prisma / better-sqlite3 入 client bundle。端点仅服务端。

**5. 乐观更新纯净性：** `nextSnippets` / `nextTags` / `deltas` 在 `setSnippets` 之前纯计算完成；updater 传的是已算好的值（`setSnippets(nextSnippets)`），非函数式 updater 搞副作用。回滚用闭包快照 `snippets` / `tags`。

**6. 边界：**
- 搜索态下选中 searchResults 里的项，可能不在 `snippets` state → 乐观更新对该项不生效（local 视图可能短暂不同步），但服务端按 ids 正确处理。v1 可接受（spec「范围外」未列，属已知次要边界）。
- `findMany` 限定 `trashed:false` → 已删项不参与；delete 不会重复软删。
- tag 事务逐条写即使未变（idempotent），少 bug。

## Execution Handoff

Plan 完成并落盘 `docs/superpowers/plans/2026-07-08-snippets-p4-batch-ops.md`。**Inline 执行**，T1 → T2 → T3 → T4。
