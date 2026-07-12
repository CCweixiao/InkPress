import { prisma } from "@/lib/db";
import { computeExpiresAt } from "@/lib/tasks/trash-lifecycle";

/** 默认清单 ID（固定值，migration seed 中使用同一常量）。 */
export const DEFAULT_LIST_ID = "cl_default_list_seed_fixed";
export const RECOVERY_LIST_NAME = "收集箱";
const LEGACY_RECOVERY_LIST_NAME = "已恢复任务";

/** 全树：folders（含嵌套 lists）+ standaloneLists（folderId=null 的清单），按 sortOrder 排序。 */
export async function listFoldersWithLists() {
  // 兼容旧版本已创建的恢复清单：加载侧边栏时立即更名，无需等待下一次删除操作。
  await prisma.taskList.updateMany({
    where: { name: LEGACY_RECOVERY_LIST_NAME, folderId: null },
    data: { name: RECOVERY_LIST_NAME },
  });
  // 收集箱是任务工作流的固定入口，不再等到首次恢复/删除任务时才创建。
  // 侧边栏首次加载即可稳定展示它（即使暂时没有任务）。
  await ensureRecoveryList();
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

/**
 * 删除文件夹时不删除其中的清单；清单提升为顶层，任务及其恢复归属保持不变。
 * 这使得被删除任务在文件夹消失后仍可回到原清单。
 */
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
      viewMode: "kanban",
      groupMode: "custom",
    },
  });
}

export async function updateList(
  id: string,
  patch: { name?: string; color?: string; folderId?: string | null; sortOrder?: number; viewMode?: string; groupMode?: string; ungroupedName?: string; ungroupedVisible?: boolean }
) {
  return prisma.taskList.update({ where: { id }, data: patch });
}

/** 返回顶层“收集箱”清单；删除清单后的任务在恢复时统一回到这里。 */
async function ensureRecoveryList(excludeId?: string) {
  const existing = await prisma.taskList.findFirst({
    where: { name: { in: [RECOVERY_LIST_NAME, LEGACY_RECOVERY_LIST_NAME] }, folderId: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  if (existing) {
    return existing.name === RECOVERY_LIST_NAME
      ? existing
      : prisma.taskList.update({ where: { id: existing.id }, data: { name: RECOVERY_LIST_NAME } });
  }

  const maxSort = await prisma.taskList.aggregate({ _max: { sortOrder: true } });
  return prisma.taskList.create({
    data: {
      name: RECOVERY_LIST_NAME,
      color: "#64748b",
      folderId: null,
      sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
      viewMode: "kanban",
      groupMode: "status",
    },
  });
}

/**
 * 删除清单：任务全部软删除并迁入“收集箱”清单；不再硬删最后一个清单的任务。
 * 由于原清单已不存在，恢复时落到该顶层清单，避免恢复到随机清单。
 */
export async function deleteList(id: string): Promise<void> {
  const recoveryList = await ensureRecoveryList(id);
  const now = new Date();
  const expiresAt = computeExpiresAt(now);
  await prisma.$transaction(async (tx) => {
    await tx.task.updateMany({
      where: { listId: id },
      data: { listId: recoveryList.id, sectionId: null, trashed: true, trashedAt: now, expiresAt },
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
