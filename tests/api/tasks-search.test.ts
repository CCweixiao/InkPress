import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { GET } from "@/app/api/tasks/route";
import { NextRequest } from "next/server";

function makeReq(query: string) {
  return new NextRequest(`http://localhost/api/tasks?${query}`);
}

describe("GET /api/tasks?q= 搜索", () => {
  beforeEach(async () => {
    await prisma.taskTag.deleteMany();
    await prisma.task.deleteMany();
    await prisma.taskList.deleteMany();
    await prisma.taskFolder.deleteMany();
  });

  it("q 匹配 title（大小写不敏感）", async () => {
    const list = await prisma.taskList.create({
      data: { id: "test_list_1", name: "L1", color: "#6b7280", sortOrder: 0 },
    });
    await prisma.task.create({
      data: { title: "写周报", listId: list.id, sortOrder: 0 },
    });
    await prisma.task.create({
      data: { title: "买牛奶", listId: list.id, sortOrder: 1 },
    });
    const res = await GET(makeReq("q=周报"));
    const data = await res.json();
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0].title).toBe("写周报");
  });

  it("q 排除 trashed 任务", async () => {
    const list = await prisma.taskList.create({
      data: { id: "test_list_2", name: "L2", color: "#6b7280", sortOrder: 0 },
    });
    await prisma.task.create({
      data: { title: "已废弃的任务", listId: list.id, sortOrder: 0, trashed: true },
    });
    const res = await GET(makeReq("q=废弃"));
    const data = await res.json();
    expect(data.tasks).toHaveLength(0);
  });

  it("limit 限制返回数量", async () => {
    const list = await prisma.taskList.create({
      data: { id: "test_list_3", name: "L3", color: "#6b7280", sortOrder: 0 },
    });
    for (let i = 0; i < 5; i++) {
      await prisma.task.create({
        data: { title: `测试任务${i}`, listId: list.id, sortOrder: i },
      });
    }
    const res = await GET(makeReq("q=测试&limit=2"));
    const data = await res.json();
    expect(data.tasks).toHaveLength(2);
  });

  it("q 存在时忽略 listId 过滤（全局搜索）", async () => {
    const l1 = await prisma.taskList.create({
      data: { id: "test_list_a", name: "LA", color: "#6b7280", sortOrder: 0 },
    });
    const l2 = await prisma.taskList.create({
      data: { id: "test_list_b", name: "LB", color: "#6b7280", sortOrder: 1 },
    });
    await prisma.task.create({
      data: { title: "全局任务", listId: l1.id, sortOrder: 0 },
    });
    await prisma.task.create({
      data: { title: "全局任务2", listId: l2.id, sortOrder: 0 },
    });
    const res = await GET(makeReq("q=全局&listId=test_list_a"));
    const data = await res.json();
    expect(data.tasks).toHaveLength(2);
  });

  it("返回 task 含 list 关系", async () => {
    const list = await prisma.taskList.create({
      data: { id: "test_list_rel", name: "关系测试", color: "#6b7280", sortOrder: 0 },
    });
    await prisma.task.create({
      data: { title: "任务带清单", listId: list.id, sortOrder: 0 },
    });
    const res = await GET(makeReq("q=任务带清单"));
    const data = await res.json();
    expect(data.tasks[0].list).toBeDefined();
    expect(data.tasks[0].list.id).toBe("test_list_rel");
    expect(data.tasks[0].list.name).toBe("关系测试");
  });
});
