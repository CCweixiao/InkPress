import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import {
  listTagsFlat,
  createTag,
  updateTag,
  deleteTag,
  reorderTags,
} from "@/lib/tasks/tag-repo";

describe("tag-repo", () => {
  beforeEach(async () => {
    await prisma.taskTag.deleteMany();
    // Tag.parentId 自引用 FK：先断开父子关系再删
    await prisma.tag.updateMany({ where: { parentId: { not: null } }, data: { parentId: null } });
    await prisma.tag.deleteMany();
  });

  it("createTag 默认 parentId=null（一级）", async () => {
    const t = await createTag({ name: "工作" });
    expect(t.parentId).toBeNull();
    expect(t.color).toBe("#6b7280");
  });

  it("createTag parentId 指向一级 → 二级", async () => {
    const parent = await createTag({ name: "生活" });
    const child = await createTag({ name: "健身", parentId: parent.id });
    expect(child.parentId).toBe(parent.id);
  });

  it("createTag parentId 指向二级 → 抛错（防三级）", async () => {
    const parent = await createTag({ name: "生活" });
    const child = await createTag({ name: "健身", parentId: parent.id });
    await expect(createTag({ name: "深蹲", parentId: child.id })).rejects.toThrow(
      "目标父标签已是二级，禁止三级嵌套"
    );
  });

  it("createTag parentId 不存在 → 抛错", async () => {
    await expect(createTag({ name: "孤儿", parentId: "nonexistent" })).rejects.toThrow(
      "父标签不存在"
    );
  });

  it("updateTag 移动：二级 → 一级（parentId=null）", async () => {
    const parent = await createTag({ name: "生活" });
    const child = await createTag({ name: "健身", parentId: parent.id });
    await updateTag(child.id, { parentId: null });
    const updated = await prisma.tag.findUnique({ where: { id: child.id } });
    expect(updated?.parentId).toBeNull();
  });

  it("updateTag 自引用 → 抛错", async () => {
    const t = await createTag({ name: "工作" });
    await expect(updateTag(t.id, { parentId: t.id })).rejects.toThrow(
      "不能把标签设为自己的子标签"
    );
  });

  it("updateTag 移动到二级标签下 → 抛错（防三级）", async () => {
    const parent = await createTag({ name: "生活" });
    const child = await createTag({ name: "健身", parentId: parent.id });
    const other = await createTag({ name: "读书" });
    await expect(updateTag(other.id, { parentId: child.id })).rejects.toThrow(
      "目标父标签已是二级，禁止三级嵌套"
    );
  });

  it("deleteTag 一级：子标签提升为一级", async () => {
    const parent = await createTag({ name: "生活" });
    const child = await createTag({ name: "健身", parentId: parent.id });
    await deleteTag(parent.id);
    const childAfter = await prisma.tag.findUnique({ where: { id: child.id } });
    expect(childAfter?.parentId).toBeNull();
  });

  it("deleteTag 二级：直接删除", async () => {
    const parent = await createTag({ name: "生活" });
    const child = await createTag({ name: "健身", parentId: parent.id });
    await deleteTag(child.id);
    const all = await listTagsFlat();
    expect(all.map((t) => t.id)).not.toContain(child.id);
    expect(all.map((t) => t.id)).toContain(parent.id);
  });

  it("reorderTags 批量更新 sortOrder", async () => {
    const a = await createTag({ name: "A" });
    const b = await createTag({ name: "B" });
    const c = await createTag({ name: "C" });
    await reorderTags([
      { id: c.id, sortOrder: 1 },
      { id: b.id, sortOrder: 2 },
      { id: a.id, sortOrder: 3 },
    ]);
    const all = await listTagsFlat();
    expect(all[0].id).toBe(c.id);
    expect(all[1].id).toBe(b.id);
    expect(all[2].id).toBe(a.id);
  });
});
