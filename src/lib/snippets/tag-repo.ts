import { prisma } from "@/lib/db";

/** include 片段：带 tag 名。所有读 snippet 的查询复用。 */
export const withTagsInclude = {
  tagAssignments: { include: { tag: { select: { name: true } } } },
} as const;

/** tag 精确过滤谓词（替代 tagsJson contains '"tag"'）。 */
export function tagWhere(name: string) {
  return { tagAssignments: { some: { tag: { name } } } };
}

/** tag 名 contains 搜索谓词（替代 tagsJson contains q）。 */
export function tagSearchWhere(q: string) {
  return { tagAssignments: { some: { tag: { name: { contains: q } } } } };
}

/** 规整 tag 名：trim + 去空 + 去重保序。纯函数。 */
export function normalizeTagNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const t = raw.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * serializeSnippet：把 include tagAssignments 的 Prisma 对象派生成客户端形状
 * { ...rest, tags: string[] }。tags 按名排序（稳定展示）。
 * 纯函数（无 prisma 调用）——可单测。
 */
export function serializeSnippet<T extends { tagAssignments: { tag: { name: string } }[] }>(
  s: T
): Omit<T, "tagAssignments"> & { tags: string[] } {
  const { tagAssignments, ...rest } = s;
  return {
    ...rest,
    tags: tagAssignments.map((a) => a.tag.name).sort((a, b) => a.localeCompare(b)),
  };
}

/** 找或建单个 tag，返回 id。 */
export async function findOrCreateTagId(name: string): Promise<string> {
  const tag = await prisma.snippetTag.upsert({
    where: { name },
    update: {},
    create: { name },
    select: { id: true },
  });
  return tag.id;
}

/** 找或建多个 tag，返 name→id。 */
export async function findOrCreateTagIds(
  names: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const name of names) {
    out.set(name, await findOrCreateTagId(name));
  }
  return out;
}

/** create/edit：把 snippet 的标签集合精确同步到目标 names（diff：删多补少，事务）。 */
export async function syncSnippetTags(
  snippetId: string,
  names: string[]
): Promise<void> {
  const target = normalizeTagNames(names);
  const targetIds = await findOrCreateTagIds(target);

  const current = await prisma.snippetTagAssignment.findMany({
    where: { snippetId },
    select: { tagId: true, tag: { select: { name: true } } },
  });
  const currentNames = new Set(current.map((c) => c.tag.name));
  const targetSet = new Set(target);

  const toAdd = target.filter((n) => !currentNames.has(n));
  const toRemoveTagIds = current
    .filter((c) => !targetSet.has(c.tag.name))
    .map((c) => c.tagId);

  await prisma.$transaction([
    ...(toRemoveTagIds.length
      ? [
          prisma.snippetTagAssignment.deleteMany({
            where: { snippetId, tagId: { in: toRemoveTagIds } },
          }),
        ]
      : []),
    ...(toAdd.length
      ? [
          prisma.snippetTagAssignment.createMany({
            data: toAdd.map((n) => ({ snippetId, tagId: targetIds.get(n)! })),
          }),
        ]
      : []),
  ]);
}

/** batch：给多个 snippet 加一个 tag（先 select 已有过滤，避 skipDuplicates 不可用）。 */
export async function bulkAddTag(
  snippetIds: string[],
  name: string
): Promise<void> {
  const tagId = await findOrCreateTagId(name);
  const existing = await prisma.snippetTagAssignment.findMany({
    where: { tagId, snippetId: { in: snippetIds } },
    select: { snippetId: true },
  });
  const have = new Set(existing.map((e) => e.snippetId));
  const toCreate = snippetIds.filter((id) => !have.has(id));
  if (toCreate.length) {
    await prisma.snippetTagAssignment.createMany({
      data: toCreate.map((snippetId) => ({ snippetId, tagId })),
    });
  }
}

/** batch：从多个 snippet 移除一个 tag。 */
export async function bulkRemoveTag(
  snippetIds: string[],
  name: string
): Promise<void> {
  const tag = await prisma.snippetTag.findUnique({
    where: { name },
    select: { id: true },
  });
  if (!tag) return; // tag 不存在，无操作
  await prisma.snippetTagAssignment.deleteMany({
    where: { tagId: tag.id, snippetId: { in: snippetIds } },
  });
}

/** 标签计数（未删 snippet），替代 collectUniqueTags。count 降序 + name 升序。 */
export async function countTagsByUsage(): Promise<{ name: string; count: number }[]> {
  const tags = await prisma.snippetTag.findMany({
    where: { assignments: { some: { snippet: { trashed: false } } } },
    include: {
      _count: {
        select: { assignments: { where: { snippet: { trashed: false } } } },
      },
    },
  });
  return tags
    .map((t) => ({ name: t.name, count: t._count.assignments }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
