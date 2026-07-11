import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import {
  DEFAULT_LIST_ID,
  listFoldersWithLists,
  createFolder,
  renameFolder,
  deleteFolder,
  reorderFolders,
  createList,
  updateList,
  deleteList,
  reorderLists,
} from "@/lib/tasks/list-repo";

describe("list-repo", () => {
  beforeEach(async () => {
    await prisma.task.deleteMany();
    await prisma.taskList.deleteMany();
    await prisma.taskFolder.deleteMany();
  });

  it("createFolder + listFoldersWithLists 返回树", async () => {
    const f = await createFolder("工作");
    const tree = await listFoldersWithLists();
    expect(tree.folders).toHaveLength(1);
    expect(tree.folders[0].id).toBe(f.id);
    expect(tree.standaloneLists).toHaveLength(0);
  });

  it("deleteFolder 把其下 list 提升为顶层", async () => {
    const f = await createFolder("工作");
    const l = await createList({ name: "OKR", folderId: f.id });
    await deleteFolder(f.id);
    const tree = await listFoldersWithLists();
    expect(tree.folders).toHaveLength(0);
    expect(tree.standaloneLists).toHaveLength(1);
    expect(tree.standaloneLists[0].id).toBe(l.id);
    expect(tree.standaloneLists[0].folderId).toBeNull();
  });

  it("deleteList 把其下 task 重指默认清单 + 软删进垃圾箱", async () => {
    const l = await createList({ name: "清单A" });
    const t = await prisma.task.create({ data: { title: "任务1", listId: l.id } });
    await deleteList(l.id);
    const after = await prisma.task.findUnique({ where: { id: t.id } });
    expect(after?.trashed).toBe(true);
    expect(after?.trashedAt).toBeTruthy();
    expect(after?.expiresAt).toBeTruthy();
    expect(after?.listId).toBe(DEFAULT_LIST_ID); // 重指到默认清单
    // list 已删
    const listExists = await prisma.taskList.findUnique({ where: { id: l.id } });
    expect(listExists).toBeNull();
  });

  it("deleteList 拒绝删除默认清单", async () => {
    await expect(deleteList(DEFAULT_LIST_ID)).rejects.toThrow();
  });

  it("reorderLists 支持跨父级移动（folderId 变更）", async () => {
    const f1 = await createFolder("F1");
    const f2 = await createFolder("F2");
    const l = await createList({ name: "L1", folderId: f1.id });
    await reorderLists([{ id: l.id, sortOrder: 0, folderId: f2.id }]);
    const after = await prisma.taskList.findUnique({ where: { id: l.id } });
    expect(after?.folderId).toBe(f2.id);
  });

  it("reorderFolders 批量更新 sortOrder", async () => {
    const a = await createFolder("A");
    const b = await createFolder("B");
    await reorderFolders([{ id: b.id, sortOrder: 1 }, { id: a.id, sortOrder: 2 }]);
    const aa = await prisma.taskFolder.findUnique({ where: { id: a.id } });
    const bb = await prisma.taskFolder.findUnique({ where: { id: b.id } });
    expect(aa?.sortOrder).toBe(2);
    expect(bb?.sortOrder).toBe(1);
  });
});
