import { prisma } from "@/lib/db";
import { normalizeColor } from "@/lib/tasks/tag-colors";

/** 扁平查询所有 tag（含未废弃任务数 _count）。客户端自组树。 */
export async function listTagsFlat() {
  return prisma.tag.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      _count: { select: { tasks: { where: { task: { trashed: false } } } } },
    },
  });
}

/** 创建 tag。parentId 非空时校验目标必须是一级（parent.parentId === null）。 */
export async function createTag({
  name,
  color,
  parentId,
}: {
  name: string;
  color?: string;
  parentId?: string | null;
}): Promise<{ id: string; name: string; color: string; parentId: string | null; sortOrder: number }> {
  if (parentId) {
    const parent = await prisma.tag.findUnique({ where: { id: parentId }, select: { parentId: true } });
    if (!parent) throw new Error("父标签不存在");
    if (parent.parentId !== null) throw new Error("目标父标签已是二级，禁止三级嵌套");
  }
  const maxSort = await prisma.tag.aggregate({ _max: { sortOrder: true } });
  return prisma.tag.create({
    data: {
      name,
      color: normalizeColor(color ?? "#6b7280"),
      parentId: parentId ?? null,
      sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
    },
    select: { id: true, name: true, color: true, parentId: true, sortOrder: true },
  });
}

/** 更新 tag。移动时校验：目标 parent 必须是一级；禁止自引用；禁止移动到自己后代下（防环）。 */
export async function updateTag(
  id: string,
  patch: { name?: string; color?: string; parentId?: string | null; sortOrder?: number }
): Promise<void> {
  // 移动校验
  if (patch.parentId !== undefined && patch.parentId !== null) {
    if (patch.parentId === id) throw new Error("不能把标签设为自己的子标签");

    // 校验目标存在且是一级
    const target = await prisma.tag.findUnique({
      where: { id: patch.parentId },
      select: { parentId: true },
    });
    if (!target) throw new Error("目标父标签不存在");
    if (target.parentId !== null) throw new Error("目标父标签已是二级，禁止三级嵌套");

    // 防环：目标不能是当前节点的后代（移动一颗子树到自己的子孙下）
    const descendants = await collectDescendants(id);
    if (descendants.has(patch.parentId)) {
      throw new Error("不能移动到自己的子标签下（会形成环）");
    }
  }

  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.color !== undefined) data.color = normalizeColor(patch.color);
  if (patch.parentId !== undefined) data.parentId = patch.parentId;
  if (patch.sortOrder !== undefined) data.sortOrder = patch.sortOrder;

  await prisma.tag.update({ where: { id }, data });
}

/** 递归收集某 tag 的所有后代 id（用于防环校验）。
 *  当前业务严格两级，所以最多查一层；但写法通用化以备未来。 */
async function collectDescendants(id: string): Promise<Set<string>> {
  const result = new Set<string>();
  const queue = [id];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = await prisma.tag.findMany({
      where: { parentId: current },
      select: { id: true },
    });
    for (const c of children) {
      if (!result.has(c.id)) {
        result.add(c.id);
        queue.push(c.id);
      }
    }
  }
  return result;
}

/** 删 tag：子标签提升为一级（parentId=null）+ 删该 tag。
 *  TaskTag 的清理由 Prisma `onDelete: Cascade` 自动处理。 */
export async function deleteTag(id: string): Promise<void> {
  await prisma.$transaction([
    prisma.tag.updateMany({ where: { parentId: id }, data: { parentId: null } }),
    prisma.tag.delete({ where: { id } }),
  ]);
}

/** 批量更新 sortOrder（事务）。 */
export async function reorderTags(items: { id: string; sortOrder: number }[]): Promise<void> {
  await prisma.$transaction(
    items.map((it) => prisma.tag.update({ where: { id: it.id }, data: { sortOrder: it.sortOrder } }))
  );
}
