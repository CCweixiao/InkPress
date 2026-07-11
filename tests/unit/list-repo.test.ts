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
    // 重新 seed 默认清单（deleteList 把 task 重指到 DEFAULT_LIST_ID）
    await prisma.taskList.upsert({
      where: { id: DEFAULT_LIST_ID },
      create: { id: DEFAULT_LIST_ID, name: "默认清单", color: "#6b7280", sortOrder: 0 },
      update: {},
    });
  });

  it("createFolder + listFoldersWithLists 返回树", async () => {
    const f = await createFolder("工作");
    const tree = await listFoldersWithLists();
    expect(tree.folders).toHaveLength(1);
    expect(tree.folders[0].id).toBe(f.id);
    // beforeEach seed 的默认清单始终存在于 standaloneLists
    expect(tree.standaloneLists).toHaveLength(1);
    expect(tree.standaloneLists[0].id).toBe(DEFAULT_LIST_ID);
  });

  it("deleteFolder 把其下 list 提升为顶层", async () => {
    const f = await createFolder("工作");
    const l = await createList({ name: "OKR", folderId: f.id });
    await deleteFolder(f.id);
    const tree = await listFoldersWithLists();
    expect(tree.folders).toHaveLength(0);
    // 默认清单 + 提升的 OKR
    expect(tree.standaloneLists).toHaveLength(2);
    const ids = tree.standaloneLists.map((s) => s.id);
    expect(ids).toContain(l.id);
    expect(ids).toContain(DEFAULT_LIST_ID);
    const okr = tree.standaloneLists.find((s) => s.id === l.id)!;
    expect(okr.folderId).toBeNull();
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

  it("deleteList 允许删除默认清单（不再有不可删限制）", async () => {
    await deleteList(DEFAULT_LIST_ID);
    const exists = await prisma.taskList.findUnique({ where: { id: DEFAULT_LIST_ID } });
    expect(exists).toBeNull();
  });

  it("deleteList 最后一个清单时硬删其下 task", async () => {
    // 先删掉 seed 的默认清单，使清单A 成为唯一清单
    await deleteList(DEFAULT_LIST_ID);
    const l = await createList({ name: "唯一清单" });
    const t = await prisma.task.create({ data: { title: "任务1", listId: l.id } });
    await deleteList(l.id);
    const taskAfter = await prisma.task.findUnique({ where: { id: t.id } });
    expect(taskAfter).toBeNull();
    const listAfter = await prisma.taskList.findUnique({ where: { id: l.id } });
    expect(listAfter).toBeNull();
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
