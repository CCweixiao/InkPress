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
