import { prisma } from "@/lib/db";
import { computeExpiresAt } from "@/lib/tasks/trash-lifecycle";

/** 默认清单 ID（固定值，migration seed 中使用同一常量）。 */
export const DEFAULT_LIST_ID = "cl_default_list_seed_fixed";

/** 全树：folders（含嵌套 lists）+ standaloneLists（folderId=null 的清单），按 sortOrder 排序。 */
export async function listFoldersWithLists() {
  const [folders, standaloneLists] = await Promise.all([
    prisma.taskFolder.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      include: {
        lists: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
        },
      },
    }),
    prisma.taskList.findMany({
      where: { folderId: null },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    }),
  ]);
  return { folders, standaloneLists };
}

export async function createFolder(name: string) {
  const maxSort = await prisma.taskFolder.aggregate({ _max: { sortOrder: true } });
  return prisma.taskFolder.create({
    data: { name, sortOrder: (maxSort._max.sortOrder ?? 0) + 1 },
  });
}

export async function renameFolder(id: string, name: string) {
  return prisma.taskFolder.update({ where: { id }, data: { name } });
}

export async function setFolderCollapsed(id: string, collapsed: boolean) {
  return prisma.taskFolder.update({ where: { id }, data: { collapsed } });
}

/** 删 folder：其下 list 提升为顶层（folderId=null），再删 folder。 */
export async function deleteFolder(id: string): Promise<void> {
  await prisma.$transaction([
    prisma.taskList.updateMany({ where: { folderId: id }, data: { folderId: null } }),
    prisma.taskFolder.delete({ where: { id } }),
  ]);
}

/** 批量更新 folder sortOrder（事务）。 */
export async function reorderFolders(items: { id: string; sortOrder: number }[]): Promise<void> {
  await prisma.$transaction(
    items.map((it) => prisma.taskFolder.update({ where: { id: it.id }, data: { sortOrder: it.sortOrder } }))
  );
}

export async function createList({ name, color, folderId }: { name: string; color?: string; folderId?: string | null }) {
  const maxSort = await prisma.taskList.aggregate({ _max: { sortOrder: true } });
  return prisma.taskList.create({
    data: {
      name,
      color: color ?? "#6b7280",
      folderId: folderId ?? null,
      sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
    },
  });
}

export async function updateList(
  id: string,
  patch: { name?: string; color?: string; folderId?: string | null; sortOrder?: number }
) {
  return prisma.taskList.update({ where: { id }, data: patch });
}

/** 删 list：其下 task 重指到默认清单 + 软删进垃圾箱，再删 list。
 *  因为 listId NOT NULL + onDelete: Restrict，必须先把 task 挪走才能删 list。 */
export async function deleteList(id: string): Promise<void> {
  if (id === DEFAULT_LIST_ID) {
    throw new Error("默认清单不可删除");
  }
  const now = new Date();
  const expiresAt = computeExpiresAt(now);
  await prisma.$transaction(async (tx) => {
    await tx.task.updateMany({
      where: { listId: id },
      data: { listId: DEFAULT_LIST_ID, trashed: true, trashedAt: now, expiresAt },
    });
    await tx.taskList.delete({ where: { id } });
  });
}

/** 批量更新 list sortOrder + folderId（跨父级移动，事务）。 */
export async function reorderLists(
  items: { id: string; sortOrder: number; folderId?: string | null }[]
): Promise<void> {
  await prisma.$transaction(
    items.map((it) =>
      prisma.taskList.update({
        where: { id: it.id },
        data: { sortOrder: it.sortOrder, ...(it.folderId !== undefined ? { folderId: it.folderId } : {}) },
      })
    )
  );
}
